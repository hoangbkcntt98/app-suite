export type RunAction = "create_next" | "generate_pattern" | "publish" | "youtube_publish" | "create_kanji";
export type RunStatus = "running" | "success" | "failed";

export type Run = {
  id: number;
  action: RunAction;
  pattern_id: number | null;
  pattern_name: string | null;
  status: RunStatus;
  log_path: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  output_video?: string | null;
  runner_pid?: number | null;
  publish_job_id?: number | null;
};

export type RunLogRecord = Pick<
  Run,
  "id" | "status" | "log_path" | "error" | "started_at" | "finished_at" | "output_video"
>;
