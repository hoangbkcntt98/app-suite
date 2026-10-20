"use client";

import { appPath } from "@lifequest/lib/paths";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@lifequest/lib/api";

const classes = [
  {
    value: "KIEM_TU",
    label: "Kiếm Tu",
    icon: "⚔️",
    desc: "Tu luyện qua kiếm thuật, tập trung Strength và Discipline",
  },
  {
    value: "DAO_TU",
    label: "Đạo Tu",
    icon: "📚",
    desc: "Tu luyện qua ngộ đạo, tập trung Wisdom và Intelligence",
  },
  {
    value: "THE_TU",
    label: "Thể Tu",
    icon: "🥋",
    desc: "Tu luyện qua rèn luyện thể chất, tập trung Strength và Creativity",
  },
];

export default function CreateCharacterPage() {
  const router = useRouter();

  const [name, setName] = useState("Hoang");
  const [className, setClassName] = useState("KIEM_TU");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/character", {
        method: "POST",
        body: JSON.stringify({
          name,
          className,
        }),
      });

      router.push(appPath("/dashboard"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Cannot create character.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Tạo nhân vật</h1>
          <p className="text-slate-400 mt-2">
            Nhân vật này đại diện cho hành trình phát triển bản thân của bạn.
          </p>
          <Link href={appPath("/character/select")} className="mt-3 inline-block text-sm text-indigo-400">
            Quay lại chọn nhân vật
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-slate-900 border border-slate-800 p-6 space-y-6"
        >
          {error && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm text-slate-300">Tên nhân vật</label>
            <input
              className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={30}
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm text-slate-300">Chọn class</label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {classes.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setClassName(item.value)}
                  className={`rounded-xl border p-4 text-left transition ${
                    className === item.value
                      ? "border-indigo-500 bg-indigo-500/10"
                      : "border-slate-700 bg-slate-950 hover:border-slate-500"
                  }`}
                >
                  <div className="text-2xl">{item.icon}</div>
                  <div className="font-semibold mt-2">{item.label}</div>
                  <div className="text-sm text-slate-400">{item.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <button
            disabled={loading}
            className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50"
          >
            {loading ? "Đang tạo..." : "Tạo nhân vật"}
          </button>
        </form>
      </div>
    </main>
  );
}
