import { NineRouterProvider, modelForAgent, routerConfiguration } from '@agents/src/server/providers/NineRouterProvider';
import { isTrustedProxyRequest } from '@agents/src/server/security/trustedProxy';

export const runtime = 'nodejs';

function unavailable() {
  return Response.json({ error: 'Set LITTLE_AGENTS_LIVE_ENABLED=true to enable 9Router.' }, { status: 503 });
}

export async function GET(request: Request) {
  if (!isTrustedProxyRequest(request)) return Response.json({ error: 'Authenticated trusted proxy required.' }, { status: 401 });
  if (process.env.LITTLE_AGENTS_LIVE_ENABLED !== 'true') return unavailable();
  try {
    const provider = new NineRouterProvider();
    const models = await provider.listModels(request.signal);
    return Response.json({ baseURL: routerConfiguration().baseURL, models });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not fetch 9Router models.' }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedProxyRequest(request)) return Response.json({ error: 'Authenticated trusted proxy required.' }, { status: 401 });
  if (process.env.LITTLE_AGENTS_LIVE_ENABLED !== 'true') return unavailable();
  try {
    const provider = new NineRouterProvider();
    const model = modelForAgent('mochi');
    const response = await provider.generate({
      system: 'Reply with exactly the word ready.',
      prompt: 'Connection test. Reply: ready',
    }, { signal: request.signal, agentId: 'mochi' });
    return Response.json({
      ok: true,
      baseURL: routerConfiguration().baseURL,
      model,
      response: response.text.slice(0, 100),
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '9Router connection test failed.' }, { status: 502 });
  }
}
