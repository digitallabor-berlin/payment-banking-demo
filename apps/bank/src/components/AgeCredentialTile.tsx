"use client";

import { useState } from "react";
import { cardFaceState } from "@/lib/card-state.js";
import {
  BADGE_CLASS,
  dialogCopy,
  faceCopy,
  walletActionLabel,
} from "@/lib/credential-copy.js";
import type { IssuanceFlavour } from "@/lib/credential-copy.js";
import {
  AV_CREDENTIAL_TYPE_ID,
  AV_GOOGLE_CREDENTIAL_TYPE_ID,
  type AgeCredentialTypeId,
} from "@/lib/credential-types.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { CardCredentialState } from "@/lib/queries.js";
import { AddToGoogleWalletButton } from "./AddToGoogleWalletButton.js";
import { AddToWalletButton } from "./AddToWalletButton.js";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface IssuanceSession {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
}

/**
 * Which dialog copy each button's handover gets. A lookup rather than a ternary
 * in the JSX below, so the two are impossible to mismatch — the same device,
 * for the same reason, as the card tile's own FLAVOUR map.
 */
const FLAVOUR: Record<AgeCredentialTypeId, IssuanceFlavour> = {
  [AV_CREDENTIAL_TYPE_ID]: "age-eudi",
  [AV_GOOGLE_CREDENTIAL_TYPE_ID]: "age-google",
};

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
 *
 * One attestation, two credential formats, two buttons. The EUDI button issues
 * `av-sparkasse`; the Google Wallet badge issues the bare `av` profile. Unlike
 * the card's two formats these carry identical claims — they differ only in the
 * wrapper the wallet receives — but the tile still needs `formats`, because
 * `pending`, `error` and each button's label are per-format. One shared flag
 * would disable the other button and attach the first one's failure to it.
 * `session` stays singular because only one dialog can be open at a time, but
 * it remembers which format opened it so the dialog names the right wallet.
 */
export function AgeCredentialTile({
  credentialState,
  formats,
  locale,
}: {
  credentialState: CardCredentialState;
  formats: Record<AgeCredentialTypeId, CardCredentialState>;
  locale: Locale;
}) {
  const t = MESSAGES[locale];
  const [session, setSession] = useState<
    (IssuanceSession & { typeId: AgeCredentialTypeId }) | null
  >(null);
  const [pendingType, setPendingType] = useState<AgeCredentialTypeId | null>(
    null,
  );
  const [error, setError] = useState<{
    typeId: AgeCredentialTypeId;
    message: string;
  } | null>(null);

  // The FACE reflects either format — it is one attestation, and the badge has
  // no opinion about which wallet received it.
  const issuing = pendingType !== null || session !== null;
  const faceState = cardFaceState(credentialState, issuing);
  const copy = faceCopy(locale, "age", faceState);

  /** The state THIS format's button should describe, not the credential's. */
  function buttonState(typeId: AgeCredentialTypeId) {
    return cardFaceState(formats[typeId], pendingType === typeId);
  }

  async function start(typeId: AgeCredentialTypeId) {
    setPendingType(typeId);
    setError(null);
    try {
      const response = await fetch("/api/credentials/av", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialTypeId: typeId }),
      });
      if (!response.ok) {
        setError({ typeId, message: t.errors.offerNotCreated });
        return;
      }
      const body = (await response.json()) as IssuanceSession;
      setSession({
        sessionId: body.sessionId,
        offerUri: body.offerUri,
        dcApiOffer: body.dcApiOffer,
        typeId,
      });
    } catch {
      setError({ typeId, message: t.errors.connectionFailed });
    } finally {
      setPendingType(null);
    }
  }

  function errorFor(typeId: AgeCredentialTypeId) {
    return error?.typeId === typeId ? error.message : null;
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

        <div className="mt-4 flex flex-col items-start gap-3">
          <AddToWalletButton
            onStart={() => start(AV_CREDENTIAL_TYPE_ID)}
            pending={pendingType === AV_CREDENTIAL_TYPE_ID}
            error={errorFor(AV_CREDENTIAL_TYPE_ID)}
            label={walletActionLabel(
              locale,
              buttonState(AV_CREDENTIAL_TYPE_ID),
              pendingType === AV_CREDENTIAL_TYPE_ID,
            )}
          />
          <AddToGoogleWalletButton
            onStart={() => start(AV_GOOGLE_CREDENTIAL_TYPE_ID)}
            pending={pendingType === AV_GOOGLE_CREDENTIAL_TYPE_ID}
            error={errorFor(AV_GOOGLE_CREDENTIAL_TYPE_ID)}
            label={t.issuance.addToGoogleWallet}
            pendingLabel={t.issuance.preparing}
          />
        </div>
      </div>

      {session ? (
        <IssuanceDialog
          sessionId={session.sessionId}
          offerUri={session.offerUri}
          dcApiOffer={session.dcApiOffer}
          copy={dialogCopy(locale, FLAVOUR[session.typeId])}
          locale={locale}
          onClose={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}
