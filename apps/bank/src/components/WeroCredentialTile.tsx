"use client";

import { useState } from "react";
import { cardFaceState } from "@/lib/card-state.js";
import {
  BADGE_CLASS,
  dialogCopy,
  faceCopy,
  walletActionLabel,
} from "@/lib/credential-copy.js";
import { WERO_CREDENTIAL_TYPE_ID } from "@/lib/credential-types.js";
import { formatIban } from "@/lib/format.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { CardCredentialState } from "@/lib/queries.js";
import { AddToWalletButton } from "./AddToWalletButton.js";
import { EuStars } from "./EuStars.js";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface IssuanceSession {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
}

/**
 * The Wero credential, drawn as an object the way the card and the age
 * credential are.
 *
 * Deliberately not a CardTile variant and not a third button on it. Wero is a
 * separate payment instrument with its own artwork, not a third format of the
 * girocard — which is exactly the distinction `CARD_FORMAT_TYPE_IDS` keeps in
 * the query layer, and it has to hold here too or one tile would draw two
 * instruments' state on one face.
 *
 * ONE button, for the EUDI Wallet only. That is why this file has no FLAVOUR
 * lookup and no `pendingType`/`formats` machinery: those exist on the other two
 * tiles because two buttons can lie to each other about what the other issued,
 * and there is no second button here to lie to. `walletActionLabel` still owns
 * the three-way label choice, in `.ts`, for the usual reason — every vitest
 * project is `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a
 * ternary in this file would be untested.
 *
 * It posts to the CARD route with `credentialTypeId: "wero"`. Wero is payable,
 * so `processPayment` needs a card to resolve an account through, and admitting
 * the type to `PAYMENT_CREDENTIAL_TYPE_IDS` is the whole of what made that
 * route accept it — no new endpoint, no new issuance function.
 *
 * The face carries no EU stars. That corner holds the Wero wordmark instead,
 * which is branding rather than a signal and is therefore present in every
 * state — so `active` is reported by the badge beside the tile alone, exactly as
 * it is on the age credential. The corner fits one mark, not two.
 *
 * The IBAN and the holder are drawn over the ground the way the girocard's are,
 * through the same three classes, because this is the same account rendered as a
 * different instrument. `.card-object-wero` restates `.card-label`'s colour and
 * drops `.card-iban`'s text-shadow: both are tuned for white printing on dark
 * red, and white on #fdf494 is invisible rather than merely faint.
 *
 * The "Wird hinzugefügt…" state is scoped to this browser session and never
 * read back from the database — see lib/card-state.ts for why.
 */
export function WeroCredentialTile({
  cardId,
  credentialState,
  holder,
  iban,
  locale,
}: {
  cardId: string;
  credentialState: CardCredentialState;
  holder?: string;
  iban?: string;
  locale: Locale;
}) {
  const t = MESSAGES[locale];
  const [session, setSession] = useState<IssuanceSession | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // An offer is in flight from the moment the button is pressed until the
  // dialog closes, so the face changes on the click rather than a round trip
  // later.
  const issuing = pending || session !== null;
  const faceState = cardFaceState(credentialState, issuing);
  const copy = faceCopy(locale, "wero", faceState);

  async function start() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/cards/${cardId}/credential`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialTypeId: WERO_CREDENTIAL_TYPE_ID }),
      });
      if (!response.ok) {
        setError(t.errors.offerNotCreated);
        return;
      }
      setSession((await response.json()) as IssuanceSession);
    } catch {
      setError(t.errors.connectionFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="panel flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-7">
      <div
        className="card-object card-object-wero shrink-0 p-5"
        data-state={faceState}
      >
        {/* The only motion in the app, and only while something is happening. */}
        {faceState === "offered" ? <span className="card-sheen" /> : null}

        {/* Served verbatim rather than inlined as a component the way EuStars
            and SparkasseLogo are: this file carries two <linearGradient> ids,
            and inlining it would put those ids in the document where a second
            instance could collide with them. Decorative — the tile's heading
            below is already the credential's accessible name. Sized by height
            alone, so the mark's own 3.22:1 proportions are preserved. */}
        <img
          src="/wero-logo.svg"
          alt=""
          aria-hidden="true"
          className="card-brand h-5 w-auto"
        />

        <div className="relative z-10 flex h-full flex-col justify-end">
          <p className="card-label">IBAN</p>
          <p className="card-iban mt-0.5">{iban ? formatIban(iban) : ""}</p>
          <p className="card-value mt-2.5 truncate">{holder ?? ""}</p>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* The face says this too, but .card-object is a CSS background with
              no alt text, so this heading is the credential's only accessible
              name. "Wero" is a proper noun, identical in both languages, so it
              is hardcoded rather than catalogued — messages.test.ts forbids a
              leaf that reads the same in both locales. */}
          <h3 className="panel-title">Wero</h3>
          <span className={`badge ${BADGE_CLASS[faceState]} px-2.5 py-1`}>
            {faceState === "active" ? <EuStars className="h-3 w-3" /> : null}
            {copy.badge}
          </span>
        </div>

        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {copy.explain}
        </p>

        <div className="mt-4 flex flex-col items-start gap-3">
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
          copy={dialogCopy(locale, "wero-eudi")}
          locale={locale}
          onClose={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}
