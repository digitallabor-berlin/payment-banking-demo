"use client";

import { useState } from "react";
import type { CardDto } from "@/lib/queries.js";
import { STATE_COPY, cardFaceState } from "@/lib/card-state.js";
import { formatIban } from "@/lib/format.js";
import { AddToWalletButton } from "./AddToWalletButton.js";
import { EuStars } from "./EuStars.js";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface IssuanceSession {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
}

/**
 * The card, drawn as the object it is.
 *
 * This demo exists to show a payment card moving into a wallet, so the card is
 * rendered at ISO/IEC 7810 ID-1 proportions from the real Sparkasse card
 * artwork rather than as a row with an icon. The artwork already carries the
 * logo, the wordmark, the chip, the contactless mark and the network mark, so
 * the only things drawn over it are what make it *this* customer's card: the
 * account IBAN and the holder's name. When the credential goes live the EU's
 * twelve stars appear on the face — the state change lands on the artefact
 * itself, not only on a label beside it.
 *
 * This is a client component because the issuance interaction lives here. The
 * "Wird hinzugefügt…" state is scoped to this browser session, never read back
 * from the database — see lib/card-state.ts for why.
 */
export function CardTile({
  card,
  holder,
  iban,
}: {
  card: CardDto;
  holder?: string;
  iban?: string;
}) {
  const [session, setSession] = useState<IssuanceSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An offer is in flight from the moment the button is pressed until the
  // dialog closes, so the face changes on the click rather than a round trip
  // later.
  const issuing = pending || session !== null;
  const faceState = cardFaceState(card.credentialState, issuing);
  const copy = STATE_COPY[faceState];

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/cards/${card.id}/credential`, {
        method: "POST",
      });
      if (!response.ok) {
        setError("Angebot konnte nicht erstellt werden.");
        return;
      }
      const body = (await response.json()) as IssuanceSession;
      setSession({
        sessionId: body.sessionId,
        offerUri: body.offerUri,
        dcApiOffer: body.dcApiOffer,
      });
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="card-object shrink-0 p-5" data-state={faceState}>
        {/* A sweep across the face while a credential is in flight — the only
            motion in the app, and only while something is actually happening. */}
        {faceState === "offered" ? <span className="card-sheen" /> : null}

        {faceState === "active" ? (
          <EuStars className="card-stars h-7 w-7" />
        ) : null}

        <div className="relative z-10 flex h-full flex-col justify-end">
          <p className="card-label">IBAN</p>
          <p className="card-iban mt-0.5">
            {iban ? formatIban(iban) : `•••• ${card.panLast4}`}
          </p>
          <p className="card-value mt-2.5 truncate">
            {holder ?? card.cardAlias}
          </p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="panel-title">{card.cardAlias}</h3>
          <span className={`badge ${copy.badgeClass} px-2.5 py-1`}>
            {faceState === "active" ? <EuStars className="h-3 w-3" /> : null}
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
            disabled={card.credentialState === "active"}
          />
        </div>
      </div>

      {session ? (
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          dcApiOffer={session.dcApiOffer}
          onClose={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}
