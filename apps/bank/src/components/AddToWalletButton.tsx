"use client";

import { useState } from "react";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface Session {
  sessionId: string;
  offerUri: string;
}

export function AddToWalletButton({
  cardId,
  disabled = false,
}: {
  cardId: string;
  disabled?: boolean;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/cards/${cardId}/credential`, { method: "POST" });
      if (!response.ok) {
        setError("Angebot konnte nicht erstellt werden.");
        return;
      }
      const body = (await response.json()) as Session;
      setSession({ sessionId: body.sessionId, offerUri: body.offerUri });
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={start}
          disabled={disabled || pending}
          className="rounded-[var(--radius)] bg-[var(--color-primary)] px-3 py-2 text-sm font-semibold text-[var(--color-primary-foreground)] disabled:opacity-50"
        >
          {pending ? "Wird vorbereitet…" : "Zum EUDI Wallet hinzufügen"}
        </button>
        {error ? (
          <span role="alert" className="text-xs text-[var(--color-destructive)]">
            {error}
          </span>
        ) : null}
      </div>

      {session ? (
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          onClose={() => setSession(null)}
        />
      ) : null}
    </>
  );
}