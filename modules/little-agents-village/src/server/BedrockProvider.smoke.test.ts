import test from 'node:test';
import assert from 'node:assert/strict';
import { BedrockProvider } from './providers/BedrockProvider';

test('optional Bedrock smoke test (paid network inference)', {
  skip: process.env.RUN_LIVE_AI_SMOKE !== 'true',
}, async () => {
  const provider = new BedrockProvider();
  const response = await provider.generate({
    system: 'Return a short connectivity confirmation.',
    prompt: 'Reply with the word ready.',
  }, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.text.length > 0);
});
