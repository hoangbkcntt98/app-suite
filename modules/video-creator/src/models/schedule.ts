export type ScheduleMode = "daily" | "interval";
export type ScheduleKind = "grammar" | "kanji";
export type KanjiScheduleOptions = {
  source: string;
  durationSeconds: number;
  fps: number;
  autoFps: boolean;
};

export type PipelineSchedule = {
  id: number;
  kind: ScheduleKind;
  kanjiOptions: KanjiScheduleOptions;
  enabled: boolean;
  mode: ScheduleMode;
  runTime: string;
  timezone: string;
  startsAt: string | null;
  startsAtUtc: string | null;
  intervalHours: number;
  videosPerRun: number;
  nextRunAt: string | null;
  pendingVideos: number;
  forceRecreate: boolean;
  publishToFacebook: boolean;
  publishToYouTube: boolean;
  youtubePrivacy: "private" | "unlisted" | "public";
  youtubeMadeForKids: boolean | null;
  youtubeContainsSyntheticMedia: boolean | null;
  lastRunDate: string | null;
  lastRunAt: string | null;
  lastRunId: number | null;
  lastError: string | null;
  revision: string;
  updatedAt: string;
};

export type ScheduleRow = {
  id: number;
  kind: ScheduleKind;
  kanji_options: KanjiScheduleOptions;
  enabled: boolean;
  mode: ScheduleMode;
  run_time: string;
  timezone: string;
  starts_at: string | null;
  starts_at_local: string | null;
  interval_hours: number;
  videos_per_run: number;
  pending_videos?: string | number;
  force_recreate: boolean;
  publish_to_facebook: boolean;
  publish_to_youtube: boolean;
  youtube_privacy: PipelineSchedule["youtubePrivacy"];
  youtube_made_for_kids: boolean | null;
  youtube_contains_synthetic_media: boolean | null;
  last_run_date: string | null;
  last_scheduled_at: string | null;
  last_run_id: number | null;
  last_error: string | null;
  revision: string;
  updated_at: string;
};

export type ScheduleWrite = {
  id: number;
  kind: ScheduleKind;
  kanjiOptions: KanjiScheduleOptions;
  enabled: boolean;
  mode: ScheduleMode;
  startsAt: string | null;
  intervalHours: number;
  videosPerRun: number;
  runTime: string;
  timezone: string;
  forceRecreate: boolean;
  publishToFacebook: boolean;
  publishToYouTube: boolean;
  youtubePrivacy: PipelineSchedule["youtubePrivacy"];
  youtubeMadeForKids: boolean | null;
  youtubeContainsSyntheticMedia: boolean | null;
};

export function intervalTiming(start: string, hours: number, last: string | null, now = new Date()) {
  const anchor = Date.parse(start);
  const interval = hours * 3_600_000;
  const current = now.getTime();
  const latest = anchor + Math.floor((current - anchor) / interval) * interval;
  const previous = last ? Date.parse(last) : -Infinity;
  const due = current >= anchor && latest > previous ? new Date(latest).toISOString() : null;
  const next = current < anchor ? anchor : Math.max(latest, previous) + interval;
  return { due, next: new Date(next).toISOString() };
}

export function mapSchedule(row: ScheduleRow): PipelineSchedule {
  const startsAtUtc = row.starts_at ? new Date(row.starts_at).toISOString() : null;
  const lastRunAt = row.last_scheduled_at ? new Date(row.last_scheduled_at).toISOString() : null;
  const timing = row.enabled && row.mode === "interval" && startsAtUtc
    ? intervalTiming(startsAtUtc, row.interval_hours, lastRunAt) : null;
  return {
    id: row.id,
    kind: row.kind ?? "grammar",
    kanjiOptions: row.kanji_options ?? { source: "", durationSeconds: 10, fps: 25, autoFps: true },
    enabled: row.enabled,
    mode: row.mode ?? "daily",
    runTime: row.run_time.slice(0, 5),
    timezone: row.timezone,
    startsAt: row.starts_at_local ?? null,
    startsAtUtc,
    intervalHours: row.interval_hours ?? 5,
    videosPerRun: row.videos_per_run ?? 1,
    nextRunAt: timing ? timing.due ?? timing.next : null,
    pendingVideos: Number(row.pending_videos ?? 0),
    forceRecreate: row.force_recreate,
    publishToFacebook: row.publish_to_facebook,
    publishToYouTube: row.publish_to_youtube,
    youtubePrivacy: row.youtube_privacy,
    youtubeMadeForKids: row.youtube_made_for_kids,
    youtubeContainsSyntheticMedia: row.youtube_contains_synthetic_media,
    lastRunDate: row.last_run_date,
    lastRunAt,
    lastRunId: row.last_run_id,
    lastError: row.last_error,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

export function validateScheduleMode(mode: unknown): ScheduleMode {
  if (mode !== "daily" && mode !== "interval") throw new Error("Choose daily or interval schedule mode.");
  return mode;
}

export function validateScheduleKind(kind: unknown): ScheduleKind {
  if (kind !== "grammar" && kind !== "kanji") throw new Error("Choose grammar or kanji schedule.");
  return kind;
}

export function validateScheduleTime(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("Run time must use HH:mm format.");
  return value;
}

export function validateScheduleTimezone(value: string) {
  const timezone = value.trim();
  if (!timezone || timezone.length > 100) throw new Error("Choose a valid timezone.");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error("Choose a valid timezone.");
  }
  return timezone;
}

export function validateIntervalSettings(input: { startsAt?: unknown; intervalHours?: unknown; videosPerRun?: unknown }) {
  const { startsAt, intervalHours, videosPerRun } = input;
  if (typeof startsAt !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(startsAt)) {
    throw new Error("Choose a start date and time (YYYY-MM-DDTHH:mm:ss) in the selected timezone.");
  }
  const normalized = startsAt.length === 16 ? `${startsAt}:00` : startsAt;
  const date = new Date(`${normalized}Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== normalized || date.getUTCFullYear() < 1970) {
    throw new Error("Choose a valid start date and time, from year 1970 onward.");
  }
  if (typeof intervalHours !== "number" || !Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 8760) {
    throw new Error("Interval must be a whole number of hours between 1 and 8760.");
  }
  if (typeof videosPerRun !== "number" || !Number.isInteger(videosPerRun) || videosPerRun < 1 || videosPerRun > 100) {
    throw new Error("Videos per batch must be a whole number between 1 and 100.");
  }
  return { startsAt: normalized, intervalHours, videosPerRun };
}

export function validateKanjiScheduleOptions(value: unknown): KanjiScheduleOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Kanji render settings.");
  const input = value as Record<string, unknown>;
  const durationSeconds = input.durationSeconds === undefined ? 10 : input.durationSeconds;
  const fps = input.fps === undefined ? 25 : input.fps;
  const autoFps = input.autoFps === undefined ? true : input.autoFps;
  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 300 ||
      typeof fps !== "number" || !Number.isInteger(fps) || fps < 1 || fps > 60 || typeof autoFps !== "boolean" ||
      typeof input.source !== "string" || !input.source.trim() || input.source.length > 500) {
    throw new Error("Kanji: choose a source, duration must be greater than 0 and at most 300 seconds, FPS 1–60, autoFps boolean.");
  }
  return { durationSeconds, fps, autoFps, source: input.source.trim() };
}

export function scheduleId(mode: ScheduleMode, kind: ScheduleKind) {
  return (mode === "daily" ? 1 : 2) + (kind === "kanji" ? 2 : 0);
}
