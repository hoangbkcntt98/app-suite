import test from 'node:test';
import assert from 'node:assert/strict';
import { executeLiveTask } from './TaskOrchestrator';
import type { ModelProvider } from './providers/ModelProvider';
import { listWorkspaceFiles, readWorkspaceFile } from './tools/WorkspaceTools';
import { LiveTaskSchema } from './contracts';
import { isTrustedProxyRequest } from './security/trustedProxy';

test('live orchestrator registers six roles, orders event sequence, and enforces read-only blocked verdicts', async () => {
  const events: Array<{ sequence: number; type: string; agentId?: string; payload: Record<string, unknown> }> = [];
  const provider: ModelProvider = {
    id: 'mock-provider',
    async generate({ prompt }) {
      const request = JSON.parse(prompt) as { taskId: string; agentId: string };
      return {
        text: JSON.stringify({
          taskId: request.taskId,
          agentId: request.agentId,
          status: 'completed',
          summary: 'Structured mock analysis.',
          artifacts: [],
          nextActions: [],
        }),
        inputTokens: 12,
        outputTokens: 5,
        model: 'mock',
      };
    },
  };
  const repository = {
    async createRun() {},
    async appendEvent(event: { sequence: number; type: string; agentId?: string; payload: Record<string, unknown> }) { events.push(event); },
    async finishRun() {},
  };
  const controller = new AbortController();
  const result = await executeLiveTask(
    { task: 'Plan a small UI improvement.' },
    provider,
    { signal: controller.signal, onEvent() {} },
    repository,
  );
  assert.equal(result.results.length, 6);
  assert.deepEqual(result.results.map((item) => item.agentId), ['mochi', 'luna', 'foxy', 'pip', 'bobo', 'ollie']);
  assert.deepEqual(result.results.slice(3).map((item) => item.status), ['blocked', 'blocked', 'blocked']);
  assert.equal(result.outcome, 'blocked');
  assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1));
  assert.ok(events.some((event) => event.type === 'agent.tool.completed'));
});

test('workspace tools reject traversal and allow bounded read-only source inspection', async () => {
  await assert.rejects(listWorkspaceFiles({ directory: '../../' }), /outside authorized workspace/i);
  const files = await listWorkspaceFiles({ directory: 'src' });
  assert.ok(files.includes('src/simulation/engine.ts'));
  const file = await readWorkspaceFile({ path: 'src/simulation/engine.ts' });
  assert.match(file.content, /export function advance/);
  await assert.rejects(readWorkspaceFile({ path: '../../../.env.production' }));
});

test('provider failure is reported and client cancellation marks run cancelled', async () => {
  const finishes: string[] = [];
  const repository = {
    async createRun() {},
    async appendEvent() {},
    async finishRun(_id: string, status: string) { finishes.push(status); },
  };
  const failedEvents: string[] = [];
  const provider: ModelProvider = {
    id: 'failing-provider',
    async generate() { throw new Error('provider unavailable'); },
  };
  await assert.rejects(executeLiveTask(
    { task: 'Plan failure handling.' },
    provider,
    { signal: new AbortController().signal, onEvent: (event) => failedEvents.push(event.type) },
    repository,
  ), /provider unavailable/);
  assert.deepEqual(failedEvents.slice(-2), ['agent.failed', 'run.failed']);
  assert.equal(finishes.at(-1), 'failed');

  const controller = new AbortController();
  controller.abort();
  const cancelledEvents: string[] = [];
  await assert.rejects(executeLiveTask(
    { task: 'Plan cancellation handling.' },
    provider,
    { signal: controller.signal, onEvent: (event) => cancelledEvents.push(event.type) },
    repository,
  ));
  assert.equal(cancelledEvents.at(-1), 'run.cancelled');
  assert.equal(finishes.at(-1), 'cancelled');
});

test('live task validator rejects common credential patterns before persistence or provider use', () => {
  assert.equal(LiveTaskSchema.safeParse({ task: 'Plan a safe task.' }).success, true);
  assert.equal(LiveTaskSchema.safeParse({ task: 'Use api_key=sk-123456789012345678901234567890' }).success, false);
});

test('live API rejects identity headers unless trusted-proxy mode is explicitly enabled', () => {
  const previous = process.env.LITTLE_AGENTS_LIVE_TRUSTED_PROXY;
  process.env.LITTLE_AGENTS_LIVE_TRUSTED_PROXY = 'false';
  const request = new Request('http://localhost/api', { headers: { 'x-authenticated-user': 'operator' } });
  assert.equal(isTrustedProxyRequest(request), false);
  process.env.LITTLE_AGENTS_LIVE_TRUSTED_PROXY = 'true';
  assert.equal(isTrustedProxyRequest(request), true);
  if (previous === undefined) delete process.env.LITTLE_AGENTS_LIVE_TRUSTED_PROXY;
  else process.env.LITTLE_AGENTS_LIVE_TRUSTED_PROXY = previous;
});
