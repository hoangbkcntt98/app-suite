"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { apiFetch } from "@lifequest/lib/api";
import AppHeader from "@lifequest/components/AppHeader";

type Attribute = {
    id: string;
    name: string;
    icon?: string | null;
};

type Mission = {
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
    isActive: boolean;
    attribute: Attribute;
};

function toDateTime(date: string) {
    return date ? `${date}T00:00:00.000Z` : null;
}

function formatMissionDate(date?: string | null) {
    if (!date) return null;

    return new Date(date).toLocaleDateString("vi-VN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}

export default function MissionsPage() {
    const [missions, setMissions] = useState<Mission[]>([]);
    const [attributes, setAttributes] = useState<Attribute[]>([]);

    const [attributeId, setAttributeId] = useState("");
    const [title, setTitle] = useState("Học tiếng Nhật 30 phút");
    const [description, setDescription] = useState("");
    const [difficulty, setDifficulty] = useState("NORMAL");
    const [repeatType, setRepeatType] = useState("DAILY");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");
    const [customGoldReward, setCustomGoldReward] = useState("");

    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const loadData = useCallback(async () => {
        try {
            const attrData = await apiFetch<{ attributes: Attribute[] }>("/api/attributes");
            const missionData = await apiFetch<{ missions: Mission[] }>("/api/missions");

            setAttributes(attrData.attributes);
            setMissions(missionData.missions);

            if (!attributeId && attrData.attributes.length > 0) {
                setAttributeId(attrData.attributes[0].id);
            }
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Cannot load missions.");
        }
    }, [attributeId]);

    useEffect(() => {
        let ignore = false;

        async function loadInitialData() {
            try {
                const attrData = await apiFetch<{ attributes: Attribute[] }>("/api/attributes");
                const missionData = await apiFetch<{ missions: Mission[] }>("/api/missions");

                if (ignore) return;

                setAttributes(attrData.attributes);
                setMissions(missionData.missions);

                if (attrData.attributes.length > 0) {
                    setAttributeId((current) => current || attrData.attributes[0].id);
                }
            } catch (error: unknown) {
                if (!ignore) {
                    setError(error instanceof Error ? error.message : "Cannot load missions.");
                }
            }
        }

        void loadInitialData();

        return () => {
            ignore = true;
        };
    }, []);

    async function createMission(event: FormEvent) {
        event.preventDefault();
        setError("");
        setLoading(true);

        try {
            await apiFetch("/api/missions", {
                method: "POST",
                body: JSON.stringify({
                    attributeId,
                    title,
                    description: description || null,
                    difficulty,
                    repeatType,
                    startDate: toDateTime(startDate),
                    endDate: toDateTime(endDate),
                    goldReward:
                        customGoldReward.trim() === ""
                            ? null
                            : Number(customGoldReward),
                }),
            });

            setTitle("");
            setDescription("");
            setDifficulty("NORMAL");
            setRepeatType("DAILY");
            setStartDate("");
            setEndDate("");
            setCustomGoldReward("");

            await loadData();
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Cannot create mission.");
        } finally {
            setLoading(false);
        }
    }

    async function toggleMission(mission: Mission) {
        try {
            await apiFetch(`/api/missions/${mission.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    isActive: !mission.isActive,
                }),
            });

            await loadData();
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Cannot update mission.");
        }
    }

    async function deleteMission(id: string) {
        const ok = window.confirm("Xóa mission này? Logs liên quan cũng sẽ bị xóa.");
        if (!ok) return;

        try {
            await apiFetch(`/api/missions/${id}`, {
                method: "DELETE",
            });

            await loadData();
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Cannot delete mission.");
        }
    }

    async function updateMissionGold(mission: Mission) {
        const nextGold = window.prompt(
            "Gold reward mới. Để trống để quay về default theo difficulty.",
            String(mission.goldReward)
        );

        if (nextGold === null) return;

        try {
            setError("");
            await apiFetch(`/api/missions/${mission.id}`, {
                method: "PATCH",
                body: JSON.stringify({
                    goldReward: nextGold.trim() === "" ? null : Number(nextGold),
                }),
            });

            await loadData();
        } catch (error: unknown) {
            setError(error instanceof Error ? error.message : "Cannot update mission gold.");
        }
    }

    return (
        <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
            <div className="mx-auto max-w-6xl space-y-6">
                <AppHeader
                    title="Missions"
                    subtitle="Tạo các nhiệm vụ nhỏ để tăng chỉ số nhân vật."
                />

                {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
                        {error}
                    </div>
                )}

                <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <form
                        onSubmit={createMission}
                        className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-4"
                    >
                        <h2 className="text-xl font-bold">Create Mission</h2>

                        <div className="space-y-2">
                            <label className="text-sm text-slate-300">Title</label>
                            <input
                                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder="Ví dụ: Học tiếng Nhật 30 phút"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-slate-300">Description</label>
                            <textarea
                                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Ghi chú thêm..."
                                rows={3}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-slate-300">Attribute</label>
                            <select
                                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                value={attributeId}
                                onChange={(e) => setAttributeId(e.target.value)}
                                required
                            >
                                {attributes.map((attribute) => (
                                    <option key={attribute.id} value={attribute.id}>
                                        {attribute.icon} {attribute.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Difficulty</label>
                                <select
                                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                    value={difficulty}
                                    onChange={(e) => setDifficulty(e.target.value)}
                                >
                                    <option value="EASY">EASY</option>
                                    <option value="NORMAL">NORMAL</option>
                                    <option value="HARD">HARD</option>
                                    <option value="EPIC">EPIC</option>
                                </select>
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Repeat</label>
                                <select
                                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                    value={repeatType}
                                    onChange={(e) => setRepeatType(e.target.value)}
                                >
                                    <option value="DAILY">DAILY</option>
                                    <option value="WEEKLY">WEEKLY</option>
                                    <option value="ONCE">ONCE</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Start date</label>
                                <input
                                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    type="date"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-sm text-slate-300">Due date</label>
                                <input
                                    className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    type="date"
                                    min={startDate || undefined}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm text-slate-300">
                                Custom gold reward
                            </label>
                            <input
                                className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
                                value={customGoldReward}
                                onChange={(e) => setCustomGoldReward(e.target.value)}
                                type="number"
                                min="0"
                                placeholder="Để trống để dùng default"
                            />
                        </div>

                        <button
                            disabled={loading || !attributeId}
                            className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50"
                        >
                            {loading ? "Đang tạo..." : "Create Mission"}
                        </button>
                    </form>

                    <div className="lg:col-span-2 rounded-2xl bg-slate-900 border border-slate-800 p-6">
                        <h2 className="text-xl font-bold mb-5">Mission List</h2>

                        <div className="space-y-3">
                            {missions.length === 0 && (
                                <div className="rounded-xl bg-slate-950 border border-slate-800 p-5 text-slate-400">
                                    Chưa có mission nào.
                                </div>
                            )}

                            {missions.map((mission) => (
                                <div
                                    key={mission.id}
                                    className={`rounded-xl border p-4 ${mission.isActive
                                            ? "bg-slate-950 border-slate-800"
                                            : "bg-slate-900 border-slate-800 opacity-60"
                                        }`}
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span>{mission.attribute?.icon}</span>
                                                <h3 className="font-semibold">{mission.title}</h3>
                                                {!mission.isActive && (
                                                    <span className="text-xs rounded-full bg-slate-800 px-2 py-1 text-slate-400">
                                                        inactive
                                                    </span>
                                                )}
                                            </div>

                                            {mission.description && (
                                                <p className="text-sm text-slate-400 mt-1">
                                                    {mission.description}
                                                </p>
                                            )}

                                            <div className="text-sm text-slate-400 mt-2">
                                                {mission.attribute?.name} · {mission.difficulty} ·{" "}
                                                {mission.repeatType} · EXP theo chỉ số · +
                                                {mission.goldReward} Gold · Stat +{mission.statReward}
                                            </div>

                                            {(mission.startDate || mission.endDate) && (
                                                <div className="text-sm text-slate-400 mt-2">
                                                    {mission.startDate
                                                        ? `Start ${formatMissionDate(mission.startDate)}`
                                                        : "Start anytime"}
                                                    {" · "}
                                                    {mission.endDate
                                                        ? `Due ${formatMissionDate(mission.endDate)}`
                                                        : "No due date"}
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex gap-2 shrink-0">
                                            <button
                                                onClick={() => updateMissionGold(mission)}
                                                className="rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-200 hover:bg-amber-500/10"
                                            >
                                                Gold
                                            </button>

                                            <button
                                                onClick={() => toggleMission(mission)}
                                                className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
                                            >
                                                {mission.isActive ? "Tắt" : "Bật"}
                                            </button>

                                            <button
                                                onClick={() => deleteMission(mission.id)}
                                                className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
                                            >
                                                Xóa
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}
