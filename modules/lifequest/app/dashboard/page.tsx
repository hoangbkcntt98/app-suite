"use client";

import { appPath } from "@lifequest/lib/paths";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@lifequest/lib/api";
import AppHeader from "@lifequest/components/AppHeader";
import { getLevelName } from "@lifequest/lib/level";
import Image from "next/image";

const BASE_PATH = process.env.NEXT_PUBLIC_LIFEQUEST_BASE_PATH ?? "";

type DashboardData = {
    character: {
        id: string;
        name: string;
        className: string;
        level: number;
        exp: number;
        requiredExp: number;
        gold: number;
        avatarUrl?: string | null;
    };
    attributes: {
        id: string;
        name: string;
        value: number;
       icon?: string | null;
       color?: string | null;
       multiplier: number;
   }[];
   todayMissions: {
        id: string;
        title: string;
        description?: string | null;
        difficulty: string;
        repeatType: string;
        expReward: number;
        goldReward: number;
        statReward: number;
        startDate?: string | null;
        endDate?: string | null;
        completed: boolean;
        attribute: {
            id: string;
            name: string;
            icon?: string | null;
            color?: string | null;
        };
    }[];
    todayEvents: {
        id: string;
        title: string;
        location?: string | null;
        startDate: string;
        endDate?: string | null;
    }[];
    streak: number;
    quote: {
        content: string;
        author?: string | null;
    } | null;
    summary: {
        totalMissionsToday: number;
        completedMissionsToday: number;
        totalEventsToday: number;
        completionRate: number;
    };
};

function formatMissionDate(date?: string | null) {
    if (!date) return null;

    return new Date(date).toLocaleDateString("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}

type CompleteMissionResponse = {
    reward: {
        exp: number;
        gold: number;
        stat: number;
        attributeName: string;
    };
};

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [error, setError] = useState("");
    const [completingId, setCompletingId] = useState<string | null>(null);
    const [rewardMessage, setRewardMessage] = useState("");
    const [selectedStatId, setSelectedStatId] = useState<string | null>(null);
    const [expandedMissionIds, setExpandedMissionIds] = useState<Record<string, boolean>>({});

    const loadDashboard = useCallback(async () => {
        try {
            const result = await apiFetch<DashboardData>("/api/dashboard");
            setData(result);
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Cannot load dashboard.");
        }
    }, []);

    useEffect(() => {
        let ignore = false;

        apiFetch<DashboardData>("/api/dashboard")
            .then((result) => {
                if (!ignore) {
                    setData(result);
                }
            })
            .catch((error: unknown) => {
                if (!ignore) {
                    setError(error instanceof Error ? error.message : "Cannot load dashboard.");
                }
            });

        return () => {
            ignore = true;
        };
    }, []);

    async function completeMission(id: string) {
        setCompletingId(id);
        setRewardMessage("");
        setError("");

        try {
            const result = await apiFetch<CompleteMissionResponse>(`/api/missions/${id}/complete`, {
                method: "POST",
            });

            setRewardMessage(
                `+${result.reward.exp} EXP, +${result.reward.gold} Gold, ${result.reward.attributeName} +${result.reward.stat}`
            );

            await loadDashboard();
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Cannot complete mission.");
        } finally {
            setCompletingId(null);
        }
    }

    function toggleMissionDetail(id: string) {
        setExpandedMissionIds((current) => ({
            ...current,
            [id]: !current[id],
        }));
    }

    if (error && !data) {
        return (
            <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
                <div className="rounded-xl bg-slate-900 border border-slate-800 p-6">
                    <p className="text-red-300">{error}</p>
                    <div className="mt-4 flex gap-3">
                        <Link className="text-indigo-400" href={appPath("/login")}>
                            Login
                        </Link>
                        <Link className="text-indigo-400" href={appPath("/character/create")}>
                            Create Character
                        </Link>
                        <Link className="text-indigo-400" href={appPath("/character/select")}>
                            Select Character
                        </Link>
                    </div>
                </div>
            </main>
        );
    }

    if (!data) {
        return (
            <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
                Loading...
            </main>
        );
    }

    const expPercent = Math.min(
        100,
        Math.round((data.character.exp / data.character.requiredExp) * 100)
    );
    const selectedStat = data.attributes.find((attribute) => attribute.id === selectedStatId);

    return (
        <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <AppHeader
                    title="Dashboard"
                    subtitle="Hôm nay bạn sẽ level up thế nào?"
                />

                {rewardMessage && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-300">
                        Mission completed! {rewardMessage}
                    </div>
                )}

                {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
                        {error}
                    </div>
                )}

               <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                   <div className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-6">
                        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
                            <Image
                                src={`${BASE_PATH}/images/characters/level${data.character.level}.png`}
                                alt={getLevelName(data.character.level)}
                                width={200}
                                height={200}
                                className="order-2 self-center rounded-xl lg:order-1 lg:self-start"
                            />

                            <div className="order-1 flex-1 lg:order-2">
                       <div className="mb-4 grid grid-cols-2 gap-2 text-xs sm:gap-3 sm:text-sm">
                           <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 sm:px-4 sm:py-3">
                               <div className="text-slate-400">Missions today</div>
                               <div className="mt-0.5 text-base font-bold sm:mt-1 sm:text-xl">
                                   {data.summary.completedMissionsToday}/{data.summary.totalMissionsToday}
                               </div>
                           </div>
                           <div className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 sm:px-4 sm:py-3">
                               <div className="text-slate-400">Events today</div>
                               <div className="mt-0.5 text-base font-bold sm:mt-1 sm:text-xl">{data.summary.totalEventsToday}</div>
                           </div>
                       </div>

                      <div className="hidden items-start justify-between lg:flex">
                          <div>
                              <div className="text-sm text-slate-400">
                                  {data.character.className}
                              </div>
                              <h2 className="text-3xl font-bold mt-1">
                                  {data.character.name}
                              </h2>
                              <div className="text-indigo-300 mt-1">
                                   Lv. {data.character.level} - {getLevelName(data.character.level)}
                              </div>
                          </div>

                      </div>
                            </div>

                            <div className="order-3 text-center text-xs leading-relaxed lg:hidden">
                                <div className="font-semibold text-slate-300">
                                    {data.character.className} · {data.character.name}
                                </div>
                                <div className="text-indigo-300">
                                    Lv. {data.character.level} · {getLevelName(data.character.level)}
                                </div>
                            </div>
                        </div>

                        {data.attributes.length > 0 && (
                            <div className="mt-4 flex flex-wrap gap-2">
                                {data.attributes.slice(0, 8).map((attribute) => (
                                    <button
                                        key={attribute.id}
                                        type="button"
                                        onClick={() => setSelectedStatId(attribute.id)}
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-sm font-semibold hover:border-indigo-400"
                                        title={attribute.name}
                                    >
                                        <span>{attribute.icon || "•"}</span>
                                        <span>{attribute.value}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className="mt-6">
                            <div className="flex justify-between text-sm text-slate-400 mb-2">
                                <span>EXP</span>
                                <span>
                                    {data.character.exp} / {data.character.requiredExp}
                                </span>
                            </div>

                            <div className="h-3 rounded-full bg-slate-800 overflow-hidden">
                                <div
                                    className="h-full bg-indigo-500"
                                    style={{ width: `${expPercent}%` }}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mt-6">
                            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                                <div className="text-slate-400 text-sm">Gold</div>
                                <div className="text-2xl font-bold mt-1">🪙 {data.character.gold}</div>
                            </div>

                            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
                                <div className="text-slate-400 text-sm">Streak</div>
                                <div className="text-2xl font-bold mt-1">
                                    🔥 {data.streak} <span className="hidden sm:inline">days</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="rounded-2xl bg-slate-900 border border-slate-800 p-6">
                        <div className="text-sm text-slate-400">Quote hôm nay</div>
                        <p className="text-lg font-medium mt-3">
                            “{data.quote?.content || "Hãy hoàn thành một mission nhỏ hôm nay."}”
                        </p>
                    </div>
                </section>

                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-3 rounded-2xl bg-slate-900 border border-slate-800 p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h2 className="text-xl font-bold">Today&apos;s Missions</h2>
                                <div className="text-sm text-slate-400">
                                    {data.summary.completedMissionsToday}/
                                    {data.summary.totalMissionsToday} completed
                                </div>
                            </div>
                            <Link
                                href={appPath("/missions")}
                                aria-label="Manage missions"
                                className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-sm hover:bg-indigo-400 sm:w-auto sm:px-4"
                            >
                                <span aria-hidden="true">⚙</span>
                                <span className="sr-only sm:not-sr-only sm:ml-2">
                                    Manage
                                </span>
                            </Link>
                        </div>

                        <div className="space-y-3">
                            {data.todayMissions.length === 0 && (
                                <div className="rounded-xl bg-slate-950 border border-slate-800 p-5 text-slate-400">
                                    Chưa có mission nào.{" "}
                                    <Link href={appPath("/missions")} className="text-indigo-400">
                                        Tạo mission đầu tiên
                                    </Link>
                                </div>
                            )}

                            {data.todayMissions.map((mission) => (
                                <div
                                    key={mission.id}
                                    className="rounded-xl bg-slate-950 border border-slate-800 p-4"
                                >
                                    <div className="space-y-3">
                                        <div className="flex min-w-0 items-center gap-2">
                                            <span className="shrink-0">{mission.attribute.icon}</span>
                                            <h3
                                                className={`min-w-0 flex-1 font-semibold leading-snug ${mission.completed ? "line-through text-slate-500" : ""
                                                    }`}
                                            >
                                                {mission.title}
                                            </h3>
                                            <button
                                                type="button"
                                                onClick={() => toggleMissionDetail(mission.id)}
                                                aria-label={
                                                    expandedMissionIds[mission.id]
                                                        ? "Hide mission details"
                                                        : "Show mission details"
                                                }
                                                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-800 bg-white text-slate-950 hover:bg-slate-100"
                                            >
                                                <span
                                                    className={`transition-transform ${
                                                        expandedMissionIds[mission.id] ? "rotate-180" : ""
                                                    }`}
                                                    aria-hidden="true"
                                                >
                                                    ↓
                                                </span>
                                            </button>
                                        </div>

                                        {expandedMissionIds[mission.id] && (
                                            <div className="space-y-3">
                                                <div className="text-sm text-slate-400">
                                                    {mission.attribute.name} · {mission.difficulty} ·
                                                    {" "}EXP theo chỉ số · +{mission.goldReward} Gold
                                                </div>

                                                <div className="text-xs text-slate-500">
                                                    Start: {formatMissionDate(mission.startDate) ?? "anytime"} · Due:{" "}
                                                    {formatMissionDate(mission.endDate) ?? "none"}
                                                </div>

                                                <button
                                                    disabled={mission.completed || completingId === mission.id}
                                                    onClick={() => completeMission(mission.id)}
                                                    className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-sm font-medium ${mission.completed
                                                            ? "bg-emerald-500/20 text-emerald-300"
                                                            : "bg-indigo-500 hover:bg-indigo-400"
                                                        } disabled:opacity-70`}
                                                    aria-label={mission.completed ? "Done" : "Complete mission"}
                                                >
                                                    <span aria-hidden="true">
                                                        {mission.completed
                                                            ? "✓"
                                                            : completingId === mission.id
                                                                ? "..."
                                                                : "✓"}
                                                    </span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </section>

                {selectedStat && (
                    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 px-4">
                        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-white p-6 text-slate-950 shadow-2xl">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex items-center gap-3">
                                    <span
                                        className="grid h-12 w-12 place-items-center rounded-xl text-2xl"
                                        style={{ backgroundColor: selectedStat.color ?? "#6366f1" }}
                                    >
                                        {selectedStat.icon || "•"}
                                    </span>
                                    <div>
                                        <h2 className="text-xl font-bold">{selectedStat.name}</h2>
                                        <p className="text-sm text-slate-500">Character stat</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedStatId(null)}
                                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-100"
                                    aria-label="Close stat detail"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
                                <div className="text-sm text-slate-500">Value</div>
                                <div className="mt-1 text-4xl font-bold">{selectedStat.value}</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </main>
    );
}
