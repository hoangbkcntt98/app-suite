import { LiveTaskSchema, type LiveTaskInput } from '@agents/src/server/contracts';
import { executeLiveTask } from '@agents/src/server/TaskOrchestrator';
import { NineRouterProvider } from '@agents/src/server/providers/NineRouterProvider';
import { getRecentRuns, initializeExecutionStore } from '@agents/src/server/persistence/ExecutionRepository';
import { isTrustedProxyRequest } from '@agents/src/server/security/trustedProxy';

export const runtime = 'nodejs';
export const maxDuration = 300;

function enabled() {
  return process.env.LITTLE_AGENTS_LIVE_ENABLED === 'true';
}

export async function GET(request: Request) {
  if (!isTrustedProxyRequest(request)) return Response.json({ error: 'Authenticated trusted proxy required.' }, { status: 401 });
  if (!enabled()) return Response.json({ enabled: false, error: 'Live AI is disabled by server configuration.' }, { status: 503 });
  try {
    await initializeExecutionStore();
    return Response.json({
      enabled: true,
      provider: '9router',
      model: process.env.NINE_ROUTER_MODEL ?? 'per-agent-configured',
      mode: 'read-only-planning',
      runs: await getRecentRuns(),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Live AI configuration error.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedProxyRequest(request)) return Response.json({ error: 'Authenticated trusted proxy required.' }, { status: 401 });
  if (!enabled()) return Response.json({ error: 'Set LITTLE_AGENTS_LIVE_ENABLED=true to enable server execution.' }, { status: 503 });
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 24_000) return Response.json({ error: 'Request exceeds 24 KB.' }, { status: 413 });

  let input: LiveTaskInput;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 24_000) return Response.json({ error: 'Request exceeds 24 KB.' }, { status: 413 });
    input = LiveTaskSchema.parse(JSON.parse(raw));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid request.' }, { status: 400 });
  }

  try {
    await initializeExecutionStore();
    const provider = new NineRouterProvider();
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    if (request.signal.aborted) abortController.abort();
    request.signal.addEventListener('abort', abort, { once: true });
    let disconnected = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: unknown) => {
          if (disconnected) return;
          try { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { disconnected = true; abortController.abort(); }
        };
        void executeLiveTask(input, provider, { signal: abortController.signal, onEvent: send })
          .catch((error: unknown) => {
            if (!abortController.signal.aborted) {
              send({ type: 'stream.error', error: error instanceof Error ? error.message : 'Execution failed.' });
            }
          })
          .finally(() => {
            request.signal.removeEventListener('abort', abort);
            try { controller.close(); } catch { /* Client disconnected. */ }
          });
      },
      cancel() { disconnected = true; abortController.abort(); },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not start live run.' }, { status: 503 });
  }
}
