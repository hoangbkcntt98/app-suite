import { validateYouTubePublishSettings, youtubeConfiguration } from "@video/lib/youtube";
import { ScheduleRepository } from "@video/repositories/scheduleRepository";
import {
  scheduleId,
  validateIntervalSettings,
  validateKanjiScheduleOptions,
  validateScheduleKind,
  validateScheduleMode,
  validateScheduleTime,
  validateScheduleTimezone,
  type PipelineSchedule,
} from "@video/models/schedule";

const defaultRepository = new ScheduleRepository();

export type UpdateScheduleInput = {
  kind?: unknown;
  kanjiOptions?: unknown;
  enabled: boolean;
  mode?: unknown;
  startsAt?: unknown;
  intervalHours?: unknown;
  videosPerRun?: unknown;
  runTime: string;
  timezone: string;
  forceRecreate: boolean;
  publishToFacebook: boolean;
  publishToYouTube?: boolean;
  youtubePrivacy?: unknown;
  youtubeMadeForKids?: unknown;
  youtubeContainsSyntheticMedia?: unknown;
};

export class ScheduleService {
  constructor(private readonly repository = defaultRepository) {}

  async get(modeValue: unknown = "daily", kindValue: unknown = "grammar") {
    const mode = validateScheduleMode(modeValue);
    const kind = validateScheduleKind(kindValue);
    try {
      return await this.repository.findById(scheduleId(mode, kind));
    } catch (error) {
      if (error instanceof Error && error.message === "Schedule is not configured.") {
        throw new Error(`${mode === "daily" ? "Daily" : "Interval"} schedule is not configured.`);
      }
      throw error;
    }
  }

  async update(input: UpdateScheduleInput): Promise<PipelineSchedule> {
    const mode = validateScheduleMode(input.mode ?? "daily");
    const kind = validateScheduleKind(input.kind ?? "grammar");
    const kanjiOptions = kind === "kanji"
      ? validateKanjiScheduleOptions(input.kanjiOptions ?? {})
      : { source: "", durationSeconds: 10, fps: 25, autoFps: true };
    const runTime = validateScheduleTime(input.runTime);
    const timezone = validateScheduleTimezone(input.timezone);
    const interval = mode === "interval" ? validateIntervalSettings(input) : null;
    const youtube = input.publishToYouTube ? validateYouTubePublishSettings({
      privacy: input.youtubePrivacy,
      madeForKids: input.youtubeMadeForKids,
      containsSyntheticMedia: input.youtubeContainsSyntheticMedia,
    }) : null;
    if (input.enabled && youtube && !youtubeConfiguration().configured) {
      throw new Error("Configure YouTube OAuth credentials in .env.local before enabling automatic uploads.");
    }

    return this.repository.save({
      id: scheduleId(mode, kind),
      kind,
      kanjiOptions,
      enabled: input.enabled,
      mode,
      startsAt: interval?.startsAt ?? null,
      intervalHours: interval?.intervalHours ?? 5,
      videosPerRun: interval?.videosPerRun ?? 1,
      runTime,
      timezone,
      forceRecreate: input.forceRecreate,
      publishToFacebook: input.publishToFacebook,
      publishToYouTube: Boolean(youtube),
      youtubePrivacy: youtube?.privacy ?? "private",
      youtubeMadeForKids: youtube?.madeForKids ?? null,
      youtubeContainsSyntheticMedia: youtube?.containsSyntheticMedia ?? null,
    });
  }

  async delete(modeValue: unknown = "daily", kindValue: unknown = "grammar") {
    const mode = validateScheduleMode(modeValue);
    const kind = validateScheduleKind(kindValue);
    await this.repository.deleteById(scheduleId(mode, kind));
  }
}
