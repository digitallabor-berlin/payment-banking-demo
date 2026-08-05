import type { TransactionDto } from "@/lib/queries.js";
import { formatBookedAt, formatEuroCents } from "@/lib/format.js";

export function TransactionRow({ transaction }: { transaction: TransactionDto }) {
  const isDebit = transaction.amountCents < 0;

  return (
    <li className="flex items-center gap-3 border-b border-[var(--color-border)] py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{transaction.counterparty}</p>
        <p className="truncate text-xs text-[var(--color-muted-foreground)]">
          {formatBookedAt(transaction.bookedAt)} · {transaction.reference}
        </p>
      </div>

      {transaction.paidWithWallet ? (
        <span
          className="badge bg-[var(--color-muted)] text-[var(--color-foreground)]"
          title="Mit dem EUDI Wallet bezahlt"
        >
          EUDI Wallet
        </span>
      ) : null}

      <span
        className={
          isDebit
            ? "tabular-nums font-semibold"
            : "tabular-nums font-semibold text-[var(--color-success)]"
        }
      >
        {formatEuroCents(transaction.amountCents)}
      </span>
    </li>
  );
}