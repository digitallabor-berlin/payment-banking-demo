import type { TransactionDto } from "@/lib/queries.js";
import type { Locale } from "@/lib/i18n/locale.js";
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
  locale,
  emptyLabel = "Keine Umsätze vorhanden.",
}: {
  transactions: TransactionDto[];
  locale: Locale;
  emptyLabel?: string;
}) {
  if (transactions.length === 0) {
    return (
      <p className="py-6 text-sm text-[var(--color-muted-foreground)]">{emptyLabel}</p>
    );
  }

  return (
    <div className="space-y-5">
      {groupByBookingDay(transactions, locale).map((day) => (
        <section key={day.key}>
          <h3 className="ledger-day pb-1.5">{day.label}</h3>
          <ul>
            {day.entries.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                locale={locale}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}