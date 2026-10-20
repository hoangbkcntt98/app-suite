"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AppHeader from "@lifequest/components/AppHeader";
import { apiFetch } from "@lifequest/lib/api";

type Stat = {
  id: string;
  name: string;
  value: number;
  icon?: string | null;
  color?: string | null;
};

const DEFAULT_COLOR = "#6366f1";
const EMOJI_OPTIONS = [
  { emoji: "💪", keywords: "strength muscle gym power force" },
  { emoji: "🧠", keywords: "mind intelligence brain knowledge learning" },
  { emoji: "🎯", keywords: "focus target goal aim precision" },
  { emoji: "📚", keywords: "study book education learning reading" },
  { emoji: "🗣️", keywords: "language speaking communication english japanese" },
  { emoji: "🇯🇵", keywords: "japanese japan language nihongo" },
  { emoji: "✍️", keywords: "writing journal notes practice" },
  { emoji: "💻", keywords: "coding computer programming tech work" },
  { emoji: "🧘", keywords: "calm meditation mindfulness balance" },
  { emoji: "🏃", keywords: "running cardio speed exercise" },
  { emoji: "🚴", keywords: "cycling bike endurance exercise" },
  { emoji: "🏋️", keywords: "weight lifting gym strength" },
  { emoji: "🥗", keywords: "nutrition food health diet vegetable" },
  { emoji: "💧", keywords: "water hydration drink health" },
  { emoji: "😴", keywords: "sleep rest recovery bedtime" },
  { emoji: "🔥", keywords: "streak fire motivation energy" },
  { emoji: "⚡", keywords: "energy lightning fast power" },
  { emoji: "🌱", keywords: "growth habit nature plant" },
  { emoji: "🏆", keywords: "achievement trophy win success" },
  { emoji: "⭐", keywords: "star favorite quality excellence" },
  { emoji: "💎", keywords: "discipline diamond value rare" },
  { emoji: "🛡️", keywords: "defense resilience protection" },
  { emoji: "🧩", keywords: "problem solving puzzle logic" },
  { emoji: "🎨", keywords: "creative art design drawing" },
  { emoji: "🎵", keywords: "music audio song practice" },
  { emoji: "🎧", keywords: "listening audio music focus" },
  { emoji: "📈", keywords: "progress growth chart improvement" },
  { emoji: "⏱️", keywords: "time speed pomodoro focus" },
  { emoji: "🧹", keywords: "clean organize chores tidy" },
  { emoji: "💰", keywords: "money finance gold budget" },
  { emoji: "🤝", keywords: "social relationship teamwork help" },
  { emoji: "❤️", keywords: "heart kindness health love" },
  { emoji: "🧪", keywords: "science experiment research" },
  { emoji: "🌍", keywords: "world travel global geography" },
  { emoji: "🚀", keywords: "launch ambition progress startup" },
  { emoji: "🧭", keywords: "direction adventure navigation purpose" },
];

export default function StatsPage() {
  const [stats, setStats] = useState<Stat[]>([]);
  const [name, setName] = useState("");
  const [value, setValue] = useState(0);
  const [icon, setIcon] = useState("");
  const [iconSearch, setIconSearch] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      setError("");
      const data = await apiFetch<{ attributes: Stat[] }>("/api/attributes");
      setStats(data.attributes);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Cannot load stats.");
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredEmojiOptions = useMemo(() => {
    const query = iconSearch.trim().toLowerCase();

    if (!query) return EMOJI_OPTIONS;

    return EMOJI_OPTIONS.filter(
      (option) =>
        option.emoji.includes(query) ||
        option.keywords.toLowerCase().includes(query)
    );
  }, [iconSearch]);

  useEffect(() => {
    let ignore = false;

    apiFetch<{ attributes: Stat[] }>("/api/attributes")
      .then((data) => {
        if (!ignore) {
          setStats(data.attributes);
        }
      })
      .catch((loadError) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Cannot load stats.");
        }
      })
      .finally(() => {
        if (!ignore) {
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, []);

  async function createStat(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      await apiFetch("/api/attributes", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          value,
          icon: icon.trim() || null,
          color: color || null,
        }),
      });

      setName("");
      setValue(0);
      setIcon("");
      setIconSearch("");
      setColor(DEFAULT_COLOR);
      setMessage("Stat created.");
      await loadStats();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Cannot create stat.");
    } finally {
      setSaving(false);
    }
  }

  async function updateStat(stat: Stat) {
    const nextName = window.prompt("Tên stat", stat.name);
    if (!nextName) return;

    const nextValue = window.prompt("Giá trị stat", String(stat.value));
    if (nextValue === null) return;

    const nextIcon = window.prompt("Icon", stat.icon ?? "");
    if (nextIcon === null) return;

    const nextColor = window.prompt("Màu HEX", stat.color ?? DEFAULT_COLOR);
    if (nextColor === null) return;

    try {
      setError("");
      setMessage("");
      await apiFetch(`/api/attributes/${stat.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: nextName.trim(),
          value: Number(nextValue),
          icon: nextIcon.trim() || null,
          color: nextColor.trim() || null,
        }),
      });

      setMessage("Stat updated.");
      await loadStats();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Cannot update stat.");
    }
  }

  async function deleteStat(stat: Stat) {
    const ok = window.confirm(`Xóa stat "${stat.name}"? Stat đang được mission dùng sẽ không thể xóa.`);
    if (!ok) return;

    try {
      setError("");
      setMessage("");
      await apiFetch(`/api/attributes/${stat.id}`, {
        method: "DELETE",
      });

      setMessage("Stat deleted.");
      await loadStats();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Cannot delete stat.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppHeader
          title="Stats"
          subtitle="Tạo và chỉnh các chỉ số cá nhân để mission tăng đúng thứ bạn muốn."
        />

        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-300">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200">
            {message}
          </div>
        )}

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <form
            onSubmit={createStat}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4"
          >
            <h2 className="text-xl font-bold">Create stat</h2>

            <div className="space-y-2">
              <label className="text-sm text-slate-300">Name</label>
              <input
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-500"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Strength, Focus, Japanese..."
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-sm text-slate-300">Value</label>
                <input
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-500"
                  type="number"
                  min="0"
                  value={value}
                  onChange={(event) => setValue(Number(event.target.value))}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm text-slate-300">Selected icon</label>
                <div className="grid h-12 place-items-center rounded-xl border border-slate-700 bg-slate-950 text-2xl">
                  {icon || "•"}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300">Search icon</label>
              <input
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-indigo-500"
                value={iconSearch}
                onChange={(event) => setIconSearch(event.target.value)}
                placeholder="focus, study, health, music..."
              />
              <div className="grid max-h-48 grid-cols-6 gap-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3">
                {filteredEmojiOptions.map((option) => (
                  <button
                    key={`${option.emoji}-${option.keywords}`}
                    type="button"
                    onClick={() => setIcon(option.emoji)}
                    title={option.keywords}
                    className={`grid h-10 place-items-center rounded-lg text-xl hover:bg-slate-800 ${
                      icon === option.emoji
                        ? "bg-indigo-500 text-white"
                        : "bg-white/70"
                    }`}
                  >
                    {option.emoji}
                  </button>
                ))}
                {filteredEmojiOptions.length === 0 && (
                  <div className="col-span-6 py-3 text-center text-sm text-slate-400">
                    No icon found.
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-300">Color</label>
              <input
                className="h-12 w-full rounded-xl border border-slate-700 bg-slate-950 px-2 py-2 outline-none focus:border-indigo-500"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              />
            </div>

            <button
              disabled={saving}
              className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : "Create stat"}
            </button>
          </form>

          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900 p-6">
            <h2 className="mb-5 text-xl font-bold">Your stats</h2>

            {loading ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-slate-400">
                Đang tải stats...
              </div>
            ) : stats.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 text-slate-400">
                Chưa có stat nào.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {stats.map((stat) => (
                  <div
                    key={stat.id}
                    className="rounded-xl border border-slate-800 bg-slate-950 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="grid h-9 w-9 place-items-center rounded-lg text-lg"
                            style={{ backgroundColor: stat.color ?? DEFAULT_COLOR }}
                          >
                            {stat.icon || "•"}
                          </span>
                          <div>
                            <h3 className="font-semibold">{stat.name}</h3>
                            <p className="text-sm text-slate-400">Value {stat.value}</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => updateStat(stat)}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteStat(stat)}
                          className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
