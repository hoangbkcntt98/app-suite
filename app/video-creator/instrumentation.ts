export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { resumeActiveRuns } = await import("@video/lib/pipeline");
    await resumeActiveRuns().catch(() => {});
    const { recoverAbandonedRuns } = await import("@video/lib/db");
    await recoverAbandonedRuns().catch(() => {});
    // Abandoned PID-less runs may have just become failed; clear/report their
    // publishing continuations before the schedule queue checks for busy work.
    await resumeActiveRuns().catch(() => {});
    const { startScheduler } = await import("@video/lib/scheduler");
    startScheduler();
    const { startBulkPublishScheduler } = await import("@video/lib/bulkPublish");
    startBulkPublishScheduler();
    const { startWordCreatorWorker } = await import("@video/lib/wordCreator/jobs");
    startWordCreatorWorker();
  }
}
