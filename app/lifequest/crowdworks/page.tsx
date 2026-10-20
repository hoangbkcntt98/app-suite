"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AppHeader from "@lifequest/components/AppHeader";
import { apiFetch } from "@lifequest/lib/api";

type CrowdworksJob = {
  id: string;
  crowdworksJobId: string | null;
  canonicalUrl: string;
  title: string;
  clientName: string | null;
  postedDate: string | null;
  applicationDeadline: string | null;
  budgetText: string | null;
  priority: number | null;
  automationLevel: string | null;
  automationReason: string | null;
  toolIdea: string | null;
  pocScope: string | null;
  estimatedManualWorkload: string | null;
  estimatedAutomationPercentage: string | null;
  suggestedProjectPrice: string | null;
  japaneseProposal: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  status: string;
  source: string;
};

type CrowdworksResponse = {
  jobs: CrowdworksJob[];
  total: number;
};

function display(value: string | null | undefined) {
  return value?.trim() || "—";
}

function formatJobDate(value: string | null) {
  if (!value) return "—";

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;

  return `${match[3]}/${match[2]}/${match[1]}`;
}

function priorityClass(priority: number | null) {
  if (priority === 5) return "bg-red-100 text-red-700";
  if (priority === 4) return "bg-orange-100 text-orange-700";
  if (priority === 3) return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-600";
}

function formatSeenAt(value: string | null) {
  if (!value) return "—";

  return new Date(value).toLocaleString("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CrowdworksPage() {
  const [jobs, setJobs] = useState<CrowdworksJob[]>([]);
  const [total, setTotal] = useState(0);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadJobs = useCallback(async (search = query, selectedStatus = status) => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ status: selectedStatus });
      if (search) params.set("q", search);
      const data = await apiFetch<CrowdworksResponse>(`/api/crowdworks-jobs?${params}`);
      setJobs(data.jobs);
      setTotal(data.total);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải jobs.");
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadJobs();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadJobs]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setQuery(queryInput.trim());
  }

  function changeStatus(nextStatus: string) {
    setStatus(nextStatus);
  }

  return (
    <main className="min-h-screen px-4 py-6 text-slate-900 md:px-8">
      <div className="mx-auto max-w-7xl">
        <AppHeader
          title="CrowdWorks Jobs"
          subtitle="Danh sách job tự động hóa đọc từ crowdworks_jobs."
        />

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-xl md:p-5">
          <form onSubmit={submitSearch} className="flex flex-col gap-3 md:flex-row">
            <input
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              placeholder="Tìm theo tiêu đề, client, tool..."
              className="min-h-11 flex-1 rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none ring-indigo-200 focus:ring-4"
            />
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-indigo-600 px-5 font-semibold text-white hover:bg-indigo-700"
            >
              Tìm kiếm
            </button>
            <select
              value={status}
              onChange={(event) => changeStatus(event.target.value)}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none ring-indigo-200 focus:ring-4"
              aria-label="Lọc trạng thái"
            >
              <option value="active">Active</option>
              <option value="all">Tất cả trạng thái</option>
            </select>
          </form>
          <p className="mt-3 text-sm text-slate-500">{total} job phù hợp</p>
        </section>

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-8 text-center text-slate-500 shadow-xl">
            Đang tải jobs...
          </div>
        ) : jobs.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white/90 p-8 text-center text-slate-500 shadow-xl">
            Không có job.
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {jobs.map((job) => (
              <article
                key={job.id}
                className="rounded-2xl border border-slate-200 bg-white/95 p-5 shadow-xl"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${priorityClass(job.priority)}`}>
                      P{job.priority ?? "—"}
                    </span>
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                      {job.status}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">#{job.crowdworksJobId ?? job.id}</span>
                </div>

                <h2 className="mt-3 text-lg font-bold leading-snug text-slate-950">{job.title}</h2>
                <p className="mt-1 text-sm text-slate-500">Client: {display(job.clientName)}</p>

                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Budget</p>
                    <p className="mt-1 font-medium">{display(job.budgetText)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Deadline</p>
                    <p className="mt-1 font-medium">{formatJobDate(job.applicationDeadline)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ngày đăng</p>
                    <p className="mt-1 font-medium">{formatJobDate(job.postedDate)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Automation</p>
                    <p className="mt-1 font-medium">{display(job.estimatedAutomationPercentage)}</p>
                    <p className="mt-1 text-xs text-slate-500">{display(job.automationLevel)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Giá đề xuất</p>
                    <p className="mt-1 font-medium">{display(job.suggestedProjectPrice)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Manual workload</p>
                    <p className="mt-1 font-medium">{display(job.estimatedManualWorkload)}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-700">Tool idea</p>
                    <p className="mt-1 whitespace-pre-line text-slate-600">{display(job.toolIdea)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">POC scope</p>
                    <p className="mt-1 whitespace-pre-line text-slate-600">{display(job.pocScope)}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-700">Lý do tự động hóa</p>
                    <p className="mt-1 whitespace-pre-line text-slate-600">{display(job.automationReason)}</p>
                  </div>
                </div>

                {job.japaneseProposal && (
                  <details className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-indigo-700">Japanese proposal</summary>
                    <p className="mt-3 whitespace-pre-line text-slate-700">{job.japaneseProposal}</p>
                  </details>
                )}

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs text-slate-400">
                  <span>Seen: {formatSeenAt(job.lastSeenAt)}</span>
                  <a
                    href={job.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    Mở trên CrowdWorks ↗
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
