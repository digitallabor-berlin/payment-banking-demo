import type { CardDto } from "@/lib/queries.js";
import { AddToWalletButton } from "./AddToWalletButton.js";

const BADGE: Record<CardDto["credentialState"], { label: string; className: string }> = {
  none: {
    label: "Nicht im Wallet",
    className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]",
  },
  offered: {
    label: "Wird hinzugefügt…",
    className: "bg-[var(--color-muted)] text-[var(--color-foreground)]",
  },
  active: {
    label: "Im Wallet ✓",
    // .badge-success is defined in globals.css (Step 5 of this task): Tailwind cannot
    // apply an opacity modifier to an arbitrary CSS variable.
    className: "badge-success",
  },
};

export function CardTile({ card }: { card: CardDto }) {
  const badge = BADGE[card.credentialState];

  return (
    <div className="panel flex items-center gap-4 p-4">
      <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-md bg-[var(--color-foreground)] text-[0.6rem] font-bold tracking-wide text-white">
        {card.network.toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium">{card.cardAlias}</p>
        <p className="font-mono text-sm text-[var(--color-muted-foreground)]">
          •••• •••• •••• {card.panLast4}
        </p>
        <span className={`badge mt-1.5 ${badge.className}`}>{badge.label}</span>
      </div>

      <AddToWalletButton cardId={card.id} disabled={card.credentialState === "active"} />
    </div>
  );
}