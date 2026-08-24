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
import { SparkasseLogo } from "./SparkasseLogo.js";

interface IssuanceSession {
 sessionId: string;
 offerUri: string;
 dcApiOffer: unknown;
}

/**
 * The Sparkassen Authenticator, drawn as an object the way the card, Wero and
 * the age credential are.
 *
 * ONE button, for the EUDI Wallet only — so, exactly as on the Wero tile, there
 * is no FLAVOUR lookup and no `pendingType`/`formats` machinery. Those exist on
 * the card and age tiles because two buttons can lie to each other about what
 * the other issued, and there is no second button here to lie to.
 * `walletActionLabel` still owns the three-way label choice, in `.ts`, for the
 * usual reason: every vitest project is `environment: "node"` with
 * `include: ["src/**\/*.test.ts"]`, so a ternary in this file would be untested.
 *
 * It posts to its OWN route, `/api/credentials/authenticator`, rather than the
 * card route Wero reuses. Wero could reuse it because Wero is payable and
 * therefore needs a card to hang the row on; this credential is not payable and
 * has no card at all, which is precisely why `isPaymentCredentialType` rejects
 * it and the card route would too.
 *
 * The face is a flat #EA0016 ground with the Sparkasse mark in the top-right
 * corner. That corner holds a brand mark OR the EU stars, never both — the
 * corner fits one — so this face carries no stars and `active` is reported by
 * the badge beside the tile alone, exactly as on the Wero and age tiles.
 *
 * `SparkasseLogo` is reused rather than a new `public/` asset being added. The
 * component draws in `currentColor`, and `.card-object` sets `color: #fff`, so
 * the mark is already white on this ground; a white-filled copy of the same
 * path in `public/` would be a second source of truth for one glyph. Sized by
 * height alone because the mark is portrait (0.769) — `h-6 w-6` would stretch
 * it by about 30%.
 *
 * The wordmark "Authenticator" is drawn top-left, in the corner opposite the
 * mark — the girocard and the age credential both have their names printed into
 * their artwork, and this face has no artwork to carry one. It is real text
 * rather than part of an image, so it is also what a screen reader reaching the
 * face gets. "Authenticator" is a proper noun, identical in both languages, so
 * it is hardcoded for the same reason the heading below is.
 *
 * Besides that, only the holder's name is drawn over the ground. No IBAN: this
 * credential attests that the holder is who they say they are, and printing an
 * account number on it would claim something it does not carry. Its sole claim
 * is an opaque `sub` UUID.
 *
 * The "Wird hinzugefügt…" state is scoped to this browser session and never
 * read back from the database — see lib/card-state.ts for why.
 */
export function SparkassenAuthTile({
 credentialState,
 holder,
 locale,
}: {
 credentialState: CardCredentialState;
 holder?: string;
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
 const copy = faceCopy(locale, "authenticator", faceState);

 async function start() {
  setPending(true);
  setError(null);
  try {
   const response = await fetch("/api/credentials/authenticator", {
    method: "POST",
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
    className="card-object card-object-auth shrink-0 p-5"
    data-state={faceState}
   >
    {/* The only motion in the app, and only while something is happening. */}
    {faceState === "offered" ? <span className="card-sheen" /> : null}

    {/* Decorative: the tile's heading below is already the credential's
            accessible name, and SparkasseLogo is aria-hidden by construction. */}
    <SparkasseLogo className="card-brand h-6 w-auto" />

    <p className="card-wordmark">Authenticator</p>

    <div className="relative z-10 flex h-full flex-col justify-end">
     <p className="card-value truncate">{holder ?? ""}</p>
    </div>
   </div>

   <div className="min-w-0 flex-1">
    <div className="flex flex-wrap items-center gap-2.5">
     {/* The face says this too, but .card-object is a CSS background with
              no alt text, so this heading is the credential's only accessible
              name. "Sparkassen Authenticator" is a proper noun, identical in
              both languages, so it is hardcoded rather than catalogued —
              messages.test.ts forbids a leaf that reads the same in both
              locales. */}
     <h3 className="panel-title">Sparkassen Authenticator</h3>
     <span className={`badge ${BADGE_CLASS[faceState]} px-2.5 py-1`}>
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
     copy={dialogCopy(locale, "authenticator-eudi")}
     locale={locale}
     onClose={() => setSession(null)}
    />
   ) : null}
  </div>
 );
}
