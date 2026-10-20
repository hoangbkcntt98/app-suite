"use client";

import { appPath } from "@lifequest/lib/paths";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@lifequest/lib/api";

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("123456");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let ignore = false;

    apiFetch<{ user: { id: string } | null }>("/api/auth/me")
      .then((data) => {
        if (!ignore && data.user) {
          router.replace(appPath("/dashboard"));
        } else if (!ignore) {
          setCheckingSession(false);
        }
      })
      .catch(() => {
        if (!ignore) {
          setCheckingSession(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [router]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          email,
          password,
        }),
      });

      router.push(appPath("/character/select"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Cannot register.");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-6 py-5 text-slate-300">
          Đang kiểm tra phiên đăng nhập...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 p-8 space-y-5"
      >
        <div>
          <h1 className="text-2xl font-bold">Tạo tài khoản</h1>
          <p className="text-slate-400 text-sm mt-1">
            Bắt đầu hành trình level up bản thân.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label className="text-sm text-slate-300">Email</label>
          <input
            className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm text-slate-300">Password</label>
          <input
            className="w-full rounded-xl bg-slate-950 border border-slate-700 px-4 py-3 outline-none focus:border-indigo-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            required
          />
        </div>

        <button
          disabled={loading}
          className="w-full rounded-xl bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50"
        >
          {loading ? "Đang tạo..." : "Register"}
        </button>

        <p className="text-sm text-slate-400 text-center">
          Đã có tài khoản?{" "}
          <Link href={appPath("/login")} className="text-indigo-400 hover:underline">
            Đăng nhập
          </Link>
        </p>
      </form>
    </main>
  );
}
