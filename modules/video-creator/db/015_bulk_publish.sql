CREATE TABLE IF NOT EXISTS video_creator_publish_batches (
  id UUID PRIMARY KEY,
  preview_hash TEXT NOT NULL,
  timezone TEXT NOT NULL,
  settings JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS video_creator_publish_jobs (
  id BIGSERIAL PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES video_creator_publish_batches(id),
  pattern_id BIGINT NOT NULL,
  pattern_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  title TEXT NOT NULL,
  caption TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'cancelled', 'skipped', 'missed', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS video_creator_publish_reserved_path_idx
  ON video_creator_publish_jobs(relative_path) WHERE state IN ('queued', 'failed');
CREATE INDEX IF NOT EXISTS video_creator_publish_due_idx
  ON video_creator_publish_jobs(scheduled_for) WHERE state = 'queued';
