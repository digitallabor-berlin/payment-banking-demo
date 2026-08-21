"use client";

import { useState } from "react";
import type { CardDto } from "@/lib/queries.js";
import { cardFaceState, stateCopy } from "@/lib/card-state.js";
import {
  BADGE_CLASS,
  dialogCopy,
  walletActionLabel,
  type IssuanceFlavour,
} from "@/lib/credential-copy.js";
import {
  DPC_CREDENTIAL_TYPE_ID,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
  type PaymentCredentialTypeId,
} from "@/lib/credential-types.js";
import { formatIban } from "@/lib/format.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { AddToGoogleWalletButton } from "./AddToGoogleWalletButton.js";
import { AddToWalletButton } from "./AddToWalletButton.js";
import { EuStars } from "./EuStars.js";
import { IssuanceDialog } from "./IssuanceDialog.js";

interface IssuanceSession {
  sessionId: string;
  offerUri: string;
  dcApiOffer: unknown;
}

/**
 * Which dialog copy each button's handover gets. A lookup rather than a ternary
 * in the JSX below, so the two are impossible to mismatch.
 */
const FLAVOUR: Record<PaymentCredentialTypeId, IssuanceFlavour> = {
  [DPC_CREDENTIAL_TYPE_ID]: "card-google",
  [SPARKASSEN_CARD_CREDENTIAL_TYPE_ID]: "card-eudi",
};

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
 * One girocard, two credential formats, two buttons. The EUDI button issues
 * `sparkassencard`; the Google Wallet badge issues the EMVCo DPC. Both run the
 * same OpenID4VCI flow through the same dialog — the badge is a different
 * presentation of the same handover, not a different protocol.
 *
 * `pending` and `error` are therefore per-format: one shared flag would disable
 * the other button and attach the first one's failure to it. `session` stays
 * singular because only one dialog can be open at a time, but it remembers
 * which format opened it so the dialog names the right wallet.
 *
 * This is a client component because the issuance interaction lives here. The
 * "Wird hinzugefügt…" state is scoped to this browser session, never read back
 * from the database — see lib/card-state.ts for why.
 */
export function CardTile({
  card,
  holder,
  iban,
  locale,
}: {
  card: CardDto;
  holder?: string;
  iban?: string;
  locale: Locale;
}) {
  const t = MESSAGES[locale];
  const [session, setSession] = useState<
    (IssuanceSession & { typeId: PaymentCredentialTypeId }) | null
  >(null);
  const [pendingType, setPendingType] =
    useState<PaymentCredentialTypeId | null>(null);
  const [error, setError] = useState<{
    typeId: PaymentCredentialTypeId;
    message: string;
  } | null>(null);

  // An offer is in flight from the moment a button is pressed until the dialog
  // closes, so the face changes on the click rather than a round trip later.
  // The FACE reflects either format — it is one card.
  const issuing = pendingType !== null || session !== null;
  const faceState = cardFaceState(card.credentialState, issuing);
  const copy = stateCopy(locale, faceState);

  /** The state THIS format's button should describe, not the card's. */
  function buttonState(typeId: PaymentCredentialTypeId) {
    return cardFaceState(card.formats[typeId], pendingType === typeId);
  }

  async function start(typeId: PaymentCredentialTypeId) {
    setPendingType(typeId);
    setError(null);
    try {
      const response = await fetch(`/api/cards/${card.id}/credential`, {
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

  function errorFor(typeId: PaymentCredentialTypeId) {
    return error?.typeId === typeId ? error.message : null;
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
            onStart={() => start(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID)}
            pending={pendingType === SPARKASSEN_CARD_CREDENTIAL_TYPE_ID}
            error={errorFor(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID)}
            label={walletActionLabel(
              locale,
              buttonState(SPARKASSEN_CARD_CREDENTIAL_TYPE_ID),
              pendingType === SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
            )}
          />
          <AddToGoogleWalletButton
            onStart={() => start(DPC_CREDENTIAL_TYPE_ID)}
            pending={pendingType === DPC_CREDENTIAL_TYPE_ID}
            error={errorFor(DPC_CREDENTIAL_TYPE_ID)}
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
