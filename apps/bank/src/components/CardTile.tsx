import type { CardDto } from "@/lib/queries.js";
import { AddToWalletButton } from "./AddToWalletButton.js";
import { EuStars } from "./EuStars.js";
import { SparkasseLogo } from "./SparkasseLogo.js";

const STATE_COPY: Record<
  CardDto["credentialState"],
  { badge: string; badgeClass: string; explain: string }
> = {
  none: {
    badge: "Nicht im Wallet",
    badgeClass: "badge-neutral",
    explain: "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
  },
  offered: {
    badge: "Wird hinzugefügt…",
    badgeClass: "badge-wallet",
    explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
  },
  active: {
    badge: "Im Wallet",
    badgeClass: "badge-success",
    explain: "Diese Karte ist in Ihrem EUDI Wallet und für Zahlungen bereit.",
  },
};

/**
 * The card, drawn as the object it is.
 *
 * This demo exists to show a payment card moving into a wallet, so the card is
 * rendered at ISO/IEC 7810 ID-1 proportions with a chip and an embossed number
 * rather than as a row with an icon. When the credential goes live, the EU's
 * twelve stars appear on the face — the state change lands on the artefact
 * itself, not only on a label beside it.
 */
export function CardTile({ card, holder }: { card: CardDto; holder?: string }) {
  const copy = STATE_COPY[card.credentialState];

  return (
    <div className="panel flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="card-object shrink-0 p-5" data-state={card.credentialState}>
        {/* A sweep across the face while a credential is in flight — the only
            motion in the app, and only while something is actually happening. */}
        {card.credentialState === "offered" ? <span className="card-sheen" /> : null}

        <div className="relative z-10 flex h-full flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <SparkasseLogo className="h-5 w-5" />
              <span className="card-value">Sparkasse</span>
            </div>
            {card.credentialState === "active" ? (
              <EuStars className="h-7 w-7 opacity-95" />
            ) : null}
          </div>

          <div className="card-chip" aria-hidden="true" />

          <div>
            <p className="card-pan">•••• •••• •••• {card.panLast4}</p>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="card-label">Karteninhaber</p>
                <p className="card-value truncate">{holder ?? card.cardAlias}</p>
              </div>
              <span className="card-network shrink-0">{card.network.toUpperCase()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="panel-title">{card.cardAlias}</h3>
          <span className={`badge ${copy.badgeClass} px-2.5 py-1`}>
            {card.credentialState === "active" ? (
              <EuStars className="h-3 w-3" />
            ) : null}
            {copy.badge}
          </span>
        </div>

        <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {copy.explain}
        </p>

        <div className="mt-4">
          <AddToWalletButton
            cardId={card.id}
            disabled={card.credentialState === "active"}
          />
        </div>
      </div>
    </div>
  );
}