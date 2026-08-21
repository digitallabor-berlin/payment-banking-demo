"use client";

import { useState } from "react";
import { cardFaceState } from "@/lib/card-state.js";
import {
  BADGE_CLASS,
  dialogCopy,
  faceCopy,
  walletActionLabel,
} from "@/lib/credential-copy.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { CardCredentialState } from "@/lib/queries.js";
import { AddToWalletButton } from "./AddToWalletButton.js";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface IssuanceSession {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
}

/**
 * The age credential, drawn as an object the way the card is.
 *
 * Deliberately not a CardTile variant. This credential has no IBAN, no PAN and
 * no network, and nothing is drawn over its face — the artwork already carries
 * the wordmark and the issuer logo. It also gets no EU stars: .card-stars is
 * positioned top-right, which on this artwork is where the wordmark is printed,
 * so the active state is carried by the badge alone.
 *
 * The "Wird hinzugefügt…" state is scoped to this browser session and never
 * read back from the database — see lib/card-state.ts for why. It applies here
 * for exactly the same reason: nothing in this project ever clears an `offered`
 * row, so a persisted offer would pin the badge on forever.
 */
export function AgeCredentialTile({
  credentialState,
  locale,
}: {
  credentialState: CardCredentialState;
  locale: Locale;
}) {
  const t = MESSAGES[locale];
  const [session, setSession] = useState<IssuanceSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issuing = pending || session !== null;
  const faceState = cardFaceState(credentialState, issuing);
  const copy = faceCopy(locale, "age", faceState);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/credentials/av", { method: "POST" });
      if (!response.ok) {
        setError(t.errors.offerNotCreated);
        return;
      }
      const body = (await response.json()) as IssuanceSession;
      setSession({
        sessionId: body.sessionId,
        offerUri: body.offerUri,
        dcApiOffer: body.dcApiOffer,
      });
    } catch {
      setError(t.errors.connectionFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-7">
      <div
        className="card-object card-object-av shrink-0"
        data-state={faceState}
      >
        {/* The only motion in the app, and only while something is happening. */}
        {faceState === "offered" ? <span className="card-sheen" /> : null}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* The face says this too, but .card-object is a CSS background with
              no alt text, so this heading is the credential's only accessible
              name. */}
          <h3 className="panel-title">{t.credential.ageTitle}</h3>
          <span className={`badge ${BADGE_CLASS[faceState]} px-2.5 py-1`}>
            {copy.badge}
          </span>
        </div>

        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {copy.explain}
        </p>

        <div className="mt-4">
          <AddToWalletButton
            onStart={start}
            pending={pending}
            error={error}
            label={walletActionLabel(locale, faceState, pending)}
          />
        </div>
      </div>

      {session ? (
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          dcApiOffer={session.dcApiOffer}
          copy={dialogCopy(locale, "age")}
          locale={locale}
          onClose={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}
