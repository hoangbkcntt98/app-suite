"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";

type BatchJob = {
  id: string;
  name: string;
  script_path: string;
  config_path: string;
  args: string[] | string;
  interval_seconds: number | null;
  run_once: boolean;
  enabled: boolean;
  next_run_at: string;
  last_run_at: string | null;
  running_count: number;
  last_status: string | null;
};

type BatchRun = {
  id: string;
  job_id: string;
  job_name: string;
  status: string;
  progress: number;
  stage: string | null;
  pid: number | null;
  log_path: string | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type Overview = {
  defaultConfigPath: string;
  jobs: BatchJob[];
  runs: BatchRun[];
};

function prettyDate(value: string | null) {
  if (!value) return "Chưa chạy";
  return new Date(value).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function argsArray(value: BatchJob["args"]) {
  if (Array.isArray(value)) return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  if (!body) {
    throw new Error(`Server returned empty response (HTTP ${response.status}).`);
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    const detail = body.trim().startsWith("<")
      ? "Server returned non-JSON response."
      : body.slice(0, 240);
    throw new Error(`${detail} (HTTP ${response.status}).`);
  }
}

export default function BatchJobManagement() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [pythonScripts, setPythonScripts] = useState<string[]>([]);
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [updatingJobId, setUpdatingJobId] = useState<string | null>(null);
  const [stoppingRunId, setStoppingRunId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [scriptPath, setScriptPath] = useState("");
  const [configPath, setConfigPath] = useState("");
  const [argsText, setArgsText] = useState("");
  const [runOnce, setRunOnce] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState<number | "">(300);

  const reloadPythonScripts = useCallback(async () => {
    setLoadingScripts(true);
    try {
      const response = await fetch("/batch-job-management/api/scripts", {
        cache: "no-store",
      });
      const data = await readResponse<{ scripts: string[] }>(response);
      if (!response.ok) throw new Error("Không tải được danh sách Python file.");
      setPythonScripts(data.scripts);
      setScriptsLoaded(true);
    } finally {
      setLoadingScripts(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    const auth = await fetch("/batch-job-management/api/auth", {
      cache: "no-store",
    });
    if (auth.status === 503) {
      setMessage("Thiếu BATCH_JOB_MANAGEMENT_TOKEN trong .env.");
      setAuthenticated(false);
      setLoading(false);
      return;
    }
    const authData = await readResponse<{ authenticated: boolean }>(auth);
    setAuthenticated(authData.authenticated);
    if (!authData.authenticated) {
      setLoading(false);
      return;
    }
    if (!scriptsLoaded) await reloadPythonScripts();
    const response = await fetch("/batch-job-management/api/jobs", {
      cache: "no-store",
    });
    const data = await readResponse<Overview & { message?: string }>(response);
    if (!response.ok) throw new Error(data.message || "Không tải được job.");
    setOverview(data);
    setMessage("");
    setLoading(false);
  }, [reloadPythonScripts, scriptsLoaded]);

  useEffect(() => {
    let active = true;
    const runRefresh = async () => {
      try {
        if (active) await refresh();
      } catch (error) {
        if (active) {
          setMessage(error instanceof Error ? error.message : "Lỗi tải dữ liệu.");
          setLoading(false);
        }
      }
    };
    void runRefresh();
    const timer = window.setInterval(runRefresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/batch-job-management/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await readResponse<{ message?: string }>(response);
      if (!response.ok) {
        setMessage(data.message || "Đăng nhập thất bại.");
        return;
      }
      setToken("");
      setAuthenticated(true);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lỗi đăng nhập.");
    } finally {
      setBusy(false);
    }
  }

  async function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        editingJobId
          ? `/batch-job-management/api/jobs/${editingJobId}`
          : "/batch-job-management/api/jobs",
        {
        method: editingJobId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editingJobId ? { edit: true } : {}),
          name,
          scriptPath,
          configPath,
          runOnce,
          intervalSeconds: runOnce ? null : intervalSeconds,
          args: argsText.split("\n").map((arg) => arg.trim()).filter(Boolean),
        }),
      });
      const data = await readResponse<{ message?: string }>(response);
      if (!response.ok) {
        setMessage(data.message || "Không tạo được schedule.");
        return;
      }
      setName("");
      setScriptPath("");
      setConfigPath("");
      setArgsText("");
      setRunOnce(false);
      setIntervalSeconds(300);
      setEditingJobId(null);
      await refresh();
      setMessage(
        editingJobId
          ? "Đã cập nhật job. Job vẫn paused; bật lại nếu muốn chạy."
          : runOnce
            ? "Đã lưu job one-time. Job sẽ chạy ngay một lần."
            : "Đã lưu schedule. Run đầu tiên bắt đầu sau interval.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lỗi tạo schedule.");
    } finally {
      setBusy(false);
    }
  }

  async function updateJob(id: string, body: Record<string, unknown>) {
    setUpdatingJobId(id);
    setMessage("");
    try {
      const response = await fetch(`/batch-job-management/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readResponse<{ message?: string }>(response);
      if (!response.ok) setMessage(data.message || "Không cập nhật được job.");
      else {
        await refresh();
        if (body.runNow === true) {
          setMessage("Đã xếp job để chạy ngay. Scheduler sẽ bắt đầu trong vài giây.");
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lỗi cập nhật job.");
    } finally {
      setUpdatingJobId(null);
    }
  }

  async function removeJob(id: string) {
    if (!window.confirm("Xóa schedule này và lịch sử run của nó?")) return;
    try {
      const response = await fetch(`/batch-job-management/api/jobs/${id}`, {
        method: "DELETE",
      });
      const data = await readResponse<{ message?: string }>(response);
      if (!response.ok) setMessage(data.message || "Không xóa được job.");
      else await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lỗi xóa job.");
    }
  }

  function editJob(job: BatchJob) {
    setEditingJobId(job.id);
    setName(job.name);
    setScriptPath(job.script_path);
    setConfigPath(job.config_path);
    setArgsText(argsArray(job.args).join("\n"));
    setRunOnce(job.run_once);
    setIntervalSeconds(job.interval_seconds ?? "");
    setMessage("Chỉnh sửa chỉ khả dụng khi job paused và không có run đang chạy.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingJobId(null);
    setName("");
    setScriptPath("");
    setConfigPath("");
    setArgsText("");
    setRunOnce(false);
    setIntervalSeconds(300);
    setMessage("");
  }

  async function stopRun(id: string) {
    setStoppingRunId(id);
    setMessage("");
    try {
      const response = await fetch(
        `/batch-job-management/api/runs/${id}/stop`,
        { method: "POST" },
      );
      const data = await readResponse<{ message?: string }>(response);
      if (!response.ok) {
        setMessage(data.message || "Không dừng được run.");
      } else {
        await refresh();
        setMessage("Đã gửi yêu cầu dừng run.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lỗi dừng run.");
    } finally {
      setStoppingRunId(null);
    }
  }

  async function signOut() {
    await fetch("/batch-job-management/api/auth", { method: "DELETE" });
    setAuthenticated(false);
    setOverview(null);
  }

  if (loading) return <main className={styles.page}><p className={styles.loading}>Đang tải bảng điều khiển...</p></main>;

  if (!authenticated) {
    return (
      <main className={styles.page}>
        <section className={styles.login}>
          <p className={styles.kicker}>BATCH JOB MANAGEMENT / PRIVATE</p>
          <h1>Job control room.</h1>
          <p>Nhập access token cấu hình bằng `BATCH_JOB_MANAGEMENT_TOKEN`.</p>
          {message && <p className={styles.error}>{message}</p>}
          <form onSubmit={signIn}>
            <label htmlFor="access-token">Access token</label>
            <input
              id="access-token"
              type="password"
              autoComplete="current-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
            />
            <button disabled={busy}>{busy ? "Đang xác thực..." : "Mở bảng điều khiển"}</button>
          </form>
        </section>
      </main>
    );
  }

  const jobs = overview?.jobs || [];
  const runs = overview?.runs || [];
  const activeRuns = runs.filter((run) => run.status === "running").length;
  const enabledJobs = jobs.filter((job) => job.enabled).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.wordmark} href="/">N / WORKSPACE</Link>
        <div className={styles.headerRight}>
          <span className={styles.live}><i /> AUTO REFRESH / 5S</span>
          <button className={styles.signOut} onClick={signOut}>Thoát</button>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.kicker}>OPERATIONS / SCHEDULED WORK</p>
          <h1>Batch jobs,<br /><em>under control.</em></h1>
          <p className={styles.intro}>Lưu schedule vào database, chạy Python theo interval, theo dõi tiến độ từng run.</p>
        </div>
        <div className={styles.heroStamp}>
          <span>QUEUE</span>
          <strong>{String(activeRuns).padStart(2, "0")}</strong>
          <small>RUNNING NOW</small>
        </div>
      </section>

      <section className={styles.metrics}>
        <article><small>SCHEDULES</small><strong>{jobs.length}</strong></article>
        <article><small>ENABLED</small><strong>{enabledJobs}</strong></article>
        <article><small>ACTIVE RUNS</small><strong>{activeRuns}</strong></article>
        <article><small>RUN HISTORY</small><strong>{runs.length}</strong></article>
      </section>

      {message && <p className={styles.notice}>{message}</p>}

      <div className={styles.layout}>
        <section className={styles.formCard}>
          <div className={styles.sectionHead}>
            <div><p className={styles.kicker}>01 / {editingJobId ? "EDIT SCHEDULE" : "NEW SCHEDULE"}</p><h2>{editingJobId ? "Sửa job" : "Tạo job"}</h2></div>
            <span className={styles.plus}>+</span>
          </div>
          <form className={styles.form} onSubmit={createJob}>
            <label>Tên job (bắt buộc)<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nightly catalog refresh" required maxLength={100} /></label>
            <label>
              Python file (bắt buộc)
              <select
                value={scriptPath}
                onChange={(event) => setScriptPath(event.target.value)}
                required
              >
                <option value="">Chọn Python file đã đăng ký</option>
                {scriptPath && !pythonScripts.includes(scriptPath) && (
                  <option value={scriptPath}>{scriptPath} (job hiện tại)</option>
                )}
                {pythonScripts.map((script) => (
                  <option value={script} key={script}>{script}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.refreshScripts}
              disabled={loadingScripts}
              onClick={() => {
                void reloadPythonScripts().catch((error) =>
                  setMessage(
                    error instanceof Error
                      ? error.message
                      : "Không tải được danh sách Python file.",
                  ),
                );
              }}
            >
              {loadingScripts ? "Đang tải..." : "Làm mới danh sách Python"}
            </button>
            <small className={styles.hint}>
              Danh sách lấy tự động từ file `.py` trong `jobs/`. Thêm file vào
              thư mục này để đăng ký.
            </small>
            <label>Config file (không bắt buộc)<input value={configPath} onChange={(event) => setConfigPath(event.target.value)} placeholder={overview?.defaultConfigPath || "Mặc định từ cấu hình server"} /></label>
            <small className={styles.hint}>Để trống để dùng config mặc định: `{overview?.defaultConfigPath || "jobs/app-tools/config.json"}`.</small>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={runOnce}
                onChange={(event) => setRunOnce(event.target.checked)}
              />
              Chạy một lần (one-time), không lặp theo lịch
            </label>
            <div className={styles.formSplit}>
              <label>
                Interval (giây, {runOnce ? "không cần với one-time" : "bắt buộc"})
                <input
                  type="number"
                  min={10}
                  max={2592000}
                  value={intervalSeconds}
                  onChange={(event) =>
                    setIntervalSeconds(
                      event.target.value === "" ? "" : Number(event.target.value)
                    )
                  }
                  required={!runOnce}
                  disabled={runOnce}
                />
              </label>
              <p>{runOnce ? "Job chạy một lần ngay sau khi lưu." : <>Run đầu tiên sau interval.<br />Giới hạn: 10 giây – 30 ngày.</>}</p>
            </div>
            <label>Tham số Python (không bắt buộc)<textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} placeholder={"--limit\n10\n--verbose"} rows={5} /></label>
            <small className={styles.hint}>Mỗi dòng là một argument riêng. Runner tự thêm `--config &lt;file&gt;`.</small>
            {editingJobId && <button type="button" className={styles.cancelEdit} onClick={cancelEdit}>Hủy sửa</button>}
            <button className={styles.primary} disabled={busy}>{busy ? "Đang lưu..." : editingJobId ? "Lưu thay đổi" : "Lưu schedule"}<span>↗</span></button>
          </form>
          <p className={styles.guardrail}>Chỉ chạy `.py` nằm trong thư mục `jobs/`. Arguments truyền trực tiếp, không qua shell.</p>
        </section>

        <section className={styles.scheduleCard}>
          <div className={styles.sectionHead}>
            <div><p className={styles.kicker}>02 / SCHEDULE REGISTRY</p><h2>Jobs đã lưu</h2></div>
            <span className={styles.count}>{jobs.length} TOTAL</span>
          </div>
          {jobs.length === 0 ? <div className={styles.empty}>Chưa có schedule. Tạo job đầu tiên ở form bên trái.</div> : (
            <div className={styles.jobList}>
              {jobs.map((job) => (
                <article className={styles.job} key={job.id}>
                  <div className={styles.jobTitle}>
                    <span className={`${styles.dot} ${job.enabled ? styles.dotOn : ""}`} />
                    <div><h3>{job.name}</h3><code>{job.script_path}</code></div>
                    <span className={`${styles.state} ${job.enabled ? styles.stateOn : ""}`}>{job.enabled ? "ENABLED" : "PAUSED"}</span>
                  </div>
                  <div className={styles.jobMeta}>
                    <span>{job.run_once ? "ONE-TIME" : `⟳ ${job.interval_seconds}s`}</span>
                    <span>Next {prettyDate(job.next_run_at)}</span>
                    <span>Last {prettyDate(job.last_run_at)}</span>
                    <span>{argsArray(job.args).length} args</span>
                  </div>
                  <div className={styles.jobConfig}><span>CONFIG</span><code>{job.config_path}</code></div>
                  {argsArray(job.args).length > 0 && (
                    <div className={styles.jobArgs}><span>ARGS</span><code>{argsArray(job.args).join(" ")}</code></div>
                  )}
                  <div className={styles.jobActions}>
                    <button
                      disabled={job.enabled || Number(job.running_count) > 0}
                      title={job.enabled || Number(job.running_count) > 0 ? "Pause job và đợi run kết thúc trước khi sửa." : "Sửa job"}
                      onClick={() => editJob(job)}
                    >
                      Edit
                    </button>
                    <button disabled={updatingJobId === job.id} onClick={() => void updateJob(job.id, { runNow: true })}>
                      {updatingJobId === job.id ? "Đang gửi..." : "Run now"}
                    </button>
                    <button disabled={updatingJobId === job.id} onClick={() => void updateJob(job.id, { enabled: !job.enabled })}>{job.enabled ? "Pause" : "Enable"}</button>
                    <button className={styles.delete} onClick={() => void removeJob(job.id)}>Delete</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className={styles.runsCard}>
        <div className={styles.sectionHead}>
          <div><p className={styles.kicker}>03 / EXECUTION TELEMETRY</p><h2>Run activity</h2></div>
          <span className={styles.count}>LATEST {runs.length}</span>
        </div>
        {runs.length === 0 ? <div className={styles.empty}>Run sẽ xuất hiện sau khi scheduler lấy schedule đến hạn.</div> : (
          <div className={styles.runTable}>
            <div className={styles.runHeader}><span>JOB / STAGE</span><span>STATUS</span><span>PROGRESS</span><span>STARTED</span><span>RUN ID</span><span>ACTION</span></div>
            {runs.map((run) => (
              <article className={styles.run} key={run.id}>
                <div className={styles.runName}><strong>{run.job_name}</strong><small>{run.stage || "starting"}{run.pid ? ` · pid ${run.pid}` : ""}</small>{run.error && <small className={styles.error}>{run.error}</small>}</div>
                <span className={`${styles.runState} ${run.status === "running" ? styles.runActive : ""}`}>{run.status}</span>
                <div className={styles.progressCell}><div className={styles.progress}><i style={{ width: `${Math.max(0, Math.min(100, run.progress))}%` }} /></div><small>{run.progress}%</small></div>
                <time>{prettyDate(run.started_at)}</time>
                <code title={run.id}>{run.id.slice(0, 8)}</code>
                {run.status === "running" ? (
                  <button
                    className={styles.stopRun}
                    disabled={stoppingRunId === run.id || run.stage === "stopping"}
                    onClick={() => void stopRun(run.id)}
                  >
                    {stoppingRunId === run.id || run.stage === "stopping" ? "Stopping..." : "Stop"}
                  </button>
                ) : <span>—</span>}
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <span>BATCH JOB MANAGEMENT / LOCAL PYTHON RUNNER</span>
        <span>RUNNER: <code>python jobs/batch_job_scheduler.py</code></span>
      </footer>
    </main>
  );
}
