"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";

export function LoginForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const t = MESSAGES[locale];
  const [username, setUsername] = useState("anna");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        setError(t.login.failed);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(t.errors.connectionFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="username" className="eyebrow block">
          {t.login.username}
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          className="field px-3.5 py-2.5"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="eyebrow block">
          {t.login.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="field px-3.5 py-2.5"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn-primary w-full py-3">
        {pending ? t.login.submitPending : t.login.submit}
      </button>

      <div className="rounded-lg bg-[var(--color-muted)] px-3.5 py-3 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        <span className="eyebrow">{t.login.demoLogins}</span>
        {/* Data, not copy: these are the literal credentials to type. */}
        <p className="mono mt-1.5 text-[var(--color-foreground)]">
          anna / demo1234 · ben / demo1234
        </p>
      </div>
    </form>
  );
}