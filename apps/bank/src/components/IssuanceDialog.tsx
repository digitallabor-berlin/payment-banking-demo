"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { QrCanvas, useIsTouch, useStatusPoll } from "@demo/ui";

/** Sparkasse red, matching --color-primary, for the QR's dark modules. */
const QR_DARK = "#ff0000";

type Phase = "waiting" | "success" | "error";

export interface IssuanceDialogProps {
  sessionId: string;
  offerUri: string;
  onClose: () => void;
}

export function IssuanceDialog({ sessionId, offerUri, onClose }: IssuanceDialogProps) {
  const router = useRouter();
  const isTouch = useIsTouch();
  const [phase, setPhase] = useState<Phase>("waiting");

  const fetchOnce = useCallback(async () => {
    const response = await fetch(`/api/credentials/${sessionId}/status`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body: unknown = await response.json();
    const state = (body as { state?: unknown }).state;
    return typeof state === "string" ? state : "offered";
  }, [sessionId]);

  const isTerminal = useCallback(
    (state: string) => state === "active" || state === "failed",
    [],
  );

  const { value, outcome } = useStatusPoll<string>({ fetchOnce, isTerminal });

  useEffect(() => {
    if (!outcome) return;
    if (outcome.status === "terminal" && outcome.value === "active") {
      setPhase("success");
      // Let the success state be seen, then refresh the dashboard behind it.
      const timer = setTimeout(() => {
        onClose();
        router.refresh();
      }, 1500);
      return () => clearTimeout(timer);
    }
    if (outcome.status !== "aborted") setPhase("error");
    return;
  }, [outcome, onClose, router]);

  const errorMessage =
    outcome?.status === "timeout"
      ? "Die Anfrage ist abgelaufen. Bitte erneut versuchen."
      : outcome?.status === "failed"
        ? "Verbindung zum Server verloren."
        : "Die Karte konnte nicht hinzugefügt werden.";

  return (
    <div
      className="dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Karte zum EUDI Wallet hinzufügen"
    >
      <div className="dialog-card">
        {phase === "waiting" ? (
          <>
            <h2 className="text-lg font-bold">Karte zum EUDI Wallet hinzufügen</h2>

            {isTouch ? (
              <>
                <a
                  href={offerUri}
                  className="mt-5 inline-block rounded-[var(--radius)] bg-[var(--color-primary)] px-5 py-2.5 font-semibold text-[var(--color-primary-foreground)]"
                >
                  Im Wallet öffnen
                </a>
                <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">
                  Bestätigen Sie das Angebot in Ihrer EUDI Wallet App.
                </p>
              </>
            ) : (
              <>
                <div className="qr-frame mt-5">
                  <QrCanvas
                    value={offerUri}
                    size={240}
                    darkColor={QR_DARK}
                    ariaLabel="QR-Code für das Credential-Angebot"
                  />
                </div>
                <p className="mt-4 text-sm text-[var(--color-muted-foreground)]">
                  Scannen Sie den Code mit Ihrer EUDI Wallet App.
                </p>
              </>
            )}

            <p className="mt-3 text-xs text-[var(--color-muted-foreground)]">
              Status: {value === "offered" || value === null ? "Warte auf Wallet…" : value}
            </p>

            <button
              type="button"
              onClick={onClose}
              className="mt-5 text-sm font-medium text-[var(--color-muted-foreground)] underline"
            >
              Abbrechen
            </button>
          </>
        ) : null}

        {phase === "success" ? (
          <>
            <div className="text-5xl" aria-hidden="true">
              🇪🇺
            </div>
            <h2 className="mt-3 text-lg font-bold text-[var(--color-success)]">
              Karte hinzugefügt
            </h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              Ihre Karte ist jetzt in Ihrem EUDI Wallet.
            </p>
          </>
        ) : null}

        {phase === "error" ? (
          <>
            <div className="text-5xl" aria-hidden="true">
              ⚠️
            </div>
            <h2 className="mt-3 text-lg font-bold">Fehlgeschlagen</h2>
            <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 rounded-[var(--radius)] bg-[var(--color-primary)] px-5 py-2.5 font-semibold text-[var(--color-primary-foreground)]"
            >
              Schließen
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}