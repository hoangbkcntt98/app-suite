import { z } from 'zod';
import { getRunEvents, initializeExecutionStore } from '@agents/src/server/persistence/ExecutionRepository';
import { isTrustedProxyRequest } from '@agents/src/server/security/trustedProxy';

export const runtime = 'nodejs';
const idSchema = z.string().uuid();

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  if (!isTrustedProxyRequest(request)) return Response.json({ error: 'Authenticated trusted proxy required.' }, { status: 401 });
  const { runId } = await context.params;
  const parsed = idSchema.safeParse(runId);
  if (!parsed.success) return Response.json({ error: 'Invalid run ID.' }, { status: 400 });
  try {
    await initializeExecutionStore();
    return Response.json({ runId, events: await getRunEvents(runId) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not load execution history.' }, { status: 500 });
  }
}
