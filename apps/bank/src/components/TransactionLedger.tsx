import type { TransactionDto } from "@/lib/queries.js";
import { groupByBookingDay } from "@/lib/ledger.js";
import { TransactionRow } from "./TransactionRow.js";

/**
 * The statement, grouped by booking date.
 *
 * The date is a rail above each run rather than a column repeated on every
 * row: within a day the order carries no information, and printing the same
 * date eleven times says nothing eleven times. Shared by the dashboard and the
 * full statement so both read identically.
 */
export function TransactionLedger({
  transactions,
  emptyLabel = "Keine Umsätze vorhanden.",
}: {
  transactions: TransactionDto[];
  emptyLabel?: string;
}) {
  if (transactions.length === 0) {
    return (
      <p className="py-6 text-sm text-[var(--color-muted-foreground)]">{emptyLabel}</p>
    );
  }

  return (
    <div className="space-y-5">
      {groupByBookingDay(transactions).map((day) => (
        <section key={day.key}>
          <h3 className="ledger-day pb-1.5">{day.label}</h3>
          <ul>
            {day.entries.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}