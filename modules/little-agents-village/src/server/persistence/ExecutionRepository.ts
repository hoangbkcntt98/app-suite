import { Pool } from 'pg';
import type { LiveEvent } from '../contracts';

let pool: Pool | undefined;
function database() {
  const connectionString = process.env.LITTLE_AGENTS_DATABASE_URL;
  if (!connectionString) throw new Error('Live AI persistence unavailable: set LITTLE_AGENTS_DATABASE_URL.');
  pool ??= new Pool({ connectionString, max: 3, ssl: process.env.LITTLE_AGENTS_DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });
  return pool;
}

export async function initializeExecutionStore() {
  await database().query(`
    CREATE TABLE IF NOT EXISTS little_agents_runs (
      run_id UUID PRIMARY KEY,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS little_agents_events (
      run_id UUID NOT NULL REFERENCES little_agents_runs(run_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      event_id UUID NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      event_data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (run_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS little_agents_events_created_idx ON little_agents_events(run_id, sequence);
    UPDATE little_agents_runs SET status='interrupted', updated_at=NOW()
      WHERE status='running' AND updated_at < NOW() - INTERVAL '10 minutes';
  `);
}

export async function createRun(runId: string, task: string, provider: string, model: string) {
  await database().query(
    'INSERT INTO little_agents_runs(run_id, task, status, provider, model) VALUES($1, $2, $3, $4, $5)',
    [runId, task, 'running', provider, model],
  );
}

export async function appendEvent(event: LiveEvent) {
  await database().query(
    'INSERT INTO little_agents_events(run_id, sequence, event_id, event_type, event_data) VALUES($1, $2, $3, $4, $5) ON CONFLICT (run_id, sequence) DO NOTHING',
    [event.runId, event.sequence, event.eventId, event.type, event],
  );
  await database().query('UPDATE little_agents_runs SET updated_at=NOW() WHERE run_id=$1', [event.runId]);
}

export async function finishRun(runId: string, status: string, inputTokens: number, outputTokens: number) {
  await database().query(
    'UPDATE little_agents_runs SET status=$2, input_tokens=$3, output_tokens=$4, updated_at=NOW() WHERE run_id=$1',
    [runId, status, inputTokens, outputTokens],
  );
}

export async function getRecentRuns(limit = 20) {
  const result = await database().query(
    'SELECT run_id AS "runId", task, status, provider, model, input_tokens AS "inputTokens", output_tokens AS "outputTokens", created_at AS "createdAt" FROM little_agents_runs ORDER BY created_at DESC LIMIT $1',
    [Math.min(Math.max(1, limit), 50)],
  );
  return result.rows;
}

export async function getRunEvents(runId: string) {
  const result = await database().query<{ event_data: LiveEvent }>(
    'SELECT event_data FROM little_agents_events WHERE run_id=$1 ORDER BY sequence ASC',
    [runId],
  );
  return result.rows.map((row) => row.event_data);
}
