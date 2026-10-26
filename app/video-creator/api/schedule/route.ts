import { ScheduleService } from "@video/services/scheduleService";
import { SchedulerService } from "@video/services/schedulerService";

export const runtime = "nodejs";
const scheduleService = new ScheduleService();
const schedulerService = new SchedulerService();

function requestMode(request: Request) {
  return new URL(request.url).searchParams.get("mode");
}
function requestKind(request: Request) {
  return new URL(request.url).searchParams.get("kind");
}

export async function GET(request: Request) {
  const mode = requestMode(request) ?? "daily";
  const kind = requestKind(request) ?? "grammar";
  try {
    schedulerService.start();
    return Response.json({ schedule: await scheduleService.get(mode, kind) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read schedule.";
    if (message === "Choose daily or interval schedule mode." || message === "Choose grammar or kanji schedule.") {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json({ error: message }, { status:
      message === "Daily schedule is not configured." || message === "Interval schedule is not configured." ? 404 : 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as {
      enabled?: unknown;
      kind?: unknown;
      kanjiOptions?: unknown;
      mode?: unknown;
      startsAt?: unknown;
      intervalHours?: unknown;
      videosPerRun?: unknown;
      runTime?: unknown;
      timezone?: unknown;
      forceRecreate?: unknown;
      publishToFacebook?: unknown;
      publishToYouTube?: unknown;
      youtubePrivacy?: unknown;
      youtubeMadeForKids?: unknown;
      youtubeContainsSyntheticMedia?: unknown;
    };
    const targetMode = requestMode(request);
    const targetKind = requestKind(request);
    const kind = body.kind ?? targetKind ?? "grammar";
    if (body.kind === null || (targetKind !== null && targetKind !== kind)) {
      return Response.json({ error: "Schedule kind does not match request." }, { status: 400 });
    }
    const mode = body.mode ?? targetMode ?? "daily";
    if (body.mode === null || (targetMode !== null && targetMode !== mode)) {
      return Response.json({ error: "Schedule mode does not match request." }, { status: 400 });
    }
    if (typeof body.enabled !== "boolean" || typeof body.timezone !== "string" ||
        (mode !== "interval" && typeof body.runTime !== "string") ||
        (body.runTime !== undefined && typeof body.runTime !== "string")) {
      return Response.json({ error: "Invalid schedule settings." }, { status: 400 });
    }
    if (body.publishToYouTube !== undefined && typeof body.publishToYouTube !== "boolean") {
      return Response.json({ error: "Publish to YouTube must be a boolean." }, { status: 400 });
    }
    schedulerService.start();
    const schedule = await scheduleService.update({
      enabled: body.enabled,
      kind,
      kanjiOptions: body.kanjiOptions,
      mode,
      startsAt: body.startsAt,
      intervalHours: body.intervalHours,
      videosPerRun: body.videosPerRun,
      runTime: typeof body.runTime === "string" ? body.runTime : "09:00",
      timezone: body.timezone,
      forceRecreate: body.forceRecreate === true,
      publishToFacebook: body.publishToFacebook === true,
      publishToYouTube: body.publishToYouTube === true,
      youtubePrivacy: body.youtubePrivacy,
      youtubeMadeForKids: body.youtubeMadeForKids,
      youtubeContainsSyntheticMedia: body.youtubeContainsSyntheticMedia,
    });
    return Response.json({ schedule });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save schedule." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    await scheduleService.delete(requestMode(request) ?? "daily", requestKind(request) ?? "grammar");
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not delete schedule." }, { status: 400 });
  }
}
