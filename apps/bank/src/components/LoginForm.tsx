"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function LoginForm() {
  const router = useRouter();
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
        setError("Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="username" className="text-sm font-medium">
          Anmeldename
        </label>
        <input
          id="username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Passwort
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2 outline-none focus:border-[var(--color-primary)]"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2.5 font-semibold text-[var(--color-primary-foreground)] disabled:opacity-60"
      >
        {pending ? "Anmelden…" : "Anmelden"}
      </button>

      <div className="rounded-[var(--radius)] bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
        <strong className="font-semibold">Demo-Zugänge:</strong> anna / demo1234 ·
        ben / demo1234
      </div>
    </form>
  );
}