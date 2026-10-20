"use client";

import { appPath } from "@manga/lib/paths";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { apiPath, routerPath } from "@manga/lib/paths";
import styles from "./AuthForm.module.css";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const isRegister = mode === "register";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        apiPath(`/api/auth/${isRegister ? "register" : "login"}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.message || "Authentication failed.");
      }

      const next = searchParams.get("next");
      router.replace(routerPath(next && next.startsWith("/") ? next : appPath("/")));
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Authentication failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <Link className={styles.logo} href={appPath("/")}>
          Manga<span>Rw</span>
        </Link>
        <h1>{isRegister ? "Create account" : "Login"}</h1>
        <p>
          {isRegister
            ? "Register an account to use this manga library."
            : "Login to continue reading and managing crawler data."}
        </p>

        <form onSubmit={submit} className={styles.form}>
          <label>
            Username
            <input
              autoComplete="username"
              autoFocus
              minLength={3}
              maxLength={32}
              onChange={(event) => setUsername(event.target.value)}
              pattern="[A-Za-z0-9_\-]+"
              required
              type="text"
              value={username}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={8}
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          {message ? <div className={styles.error}>{message}</div> : null}

          <button disabled={loading} type="submit">
            {loading ? "Please wait..." : isRegister ? "Register" : "Login"}
          </button>
        </form>

        <div className={styles.switchMode}>
          {isRegister ? (
            <>
              Already have an account? <Link href={appPath("/login")}>Login</Link>
            </>
          ) : (
            <>
              No account yet? <Link href={appPath("/register")}>Register</Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
