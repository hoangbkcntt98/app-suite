"use client";

import { useEffect, useState } from "react";
import AppHeader from "@lifequest/components/AppHeader";
import { apiFetch } from "@lifequest/lib/api";

type WeeklyReport = {
  range: {
    startDate: string;
    endDate: string;
    days: number;
  };
  character: {
    name: string;
    level: number;
    exp: number;
    requiredExp: number;
    gold: number;
    className: string;
  };
  summary: {
    totalCompleted: number;
    totalExp: number;
    totalGold: number;
    totalStat: number;
    completedDays: number;
    completionRate: number;
    activeMissionCount: number;
  };
  attributeSummary: {
    id: string;
    name: string;
    icon?: string | null;
    completedCount: number;
    expEarned: number;
    goldEarned: number;
    statEarned: number;
  }[];
  daily: {
    date: string;
    completedCount: number;
    expEarned: number;
    goldEarned: number;
    statEarned: number;
  }[];
};

export default function WeeklyReportPage() {
  const [data, setData] = useState<WeeklyReport | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadReport() {
      try {
        const result = await apiFetch<WeeklyReport>("/api/reports/weekly");
        setData(result);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Không thể tải báo cáo.");
      }
    }

    loadReport();
  }, []);

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
        <div className="mx-auto max-w-6xl">
          <AppHeader title="Weekly Report" subtitle="Báo cáo 7 ngày gần nhất." />
          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
              {error}
            </div>
          ) : (
            <div>Loading...</div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppHeader
          title="Weekly Report"
          subtitle={`${data.range.startDate} → ${data.range.endDate}`}
        />

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
            <div className="text-sm text-slate-400">Completed</div>
            <div className="text-3xl font-bold mt-2">
              {data.summary.totalCompleted}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
            <div className="text-sm text-slate-400">EXP</div>
            <div className="text-3xl font-bold mt-2">
              +{data.summary.totalExp}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
            <div className="text-sm text-slate-400">Gold</div>
            <div className="text-3xl font-bold mt-2">
              🪙 {data.summary.totalGold}
            </div>
          </div>

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5">
            <div className="text-sm text-slate-400">Completion</div>
            <div className="text-3xl font-bold mt-2">
              {data.summary.completionRate}%
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-xl font-bold mb-5">Daily Progress</h2>

          <div className="space-y-3">
            {data.daily.map((day) => (
              <div
                key={day.date}
                className="rounded-xl bg-slate-950 border border-slate-800 p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{day.date}</div>
                  <div className="text-sm text-slate-400">
                    {day.completedCount} missions
                  </div>
                </div>

                <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500"
                    style={{
                      width: `${Math.min(100, day.completedCount * 20)}%`,
                    }}
                  />
                </div>

                <div className="text-sm text-slate-400 mt-2">
                  +{day.expEarned} EXP · +{day.goldEarned} Gold · Stat +
                  {day.statEarned}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
          <h2 className="text-xl font-bold mb-5">By Attribute</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.attributeSummary.map((attribute) => (
              <div
                key={attribute.id}
                className="rounded-xl bg-slate-950 border border-slate-800 p-4"
              >
                <div className="font-semibold">
                  {attribute.icon} {attribute.name}
                </div>
                <div className="text-sm text-slate-400 mt-2">
                  {attribute.completedCount} missions · +{attribute.expEarned}{" "}
                  EXP · +{attribute.goldEarned} Gold · Stat +
                  {attribute.statEarned}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
