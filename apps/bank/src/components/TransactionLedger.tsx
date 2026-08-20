import type { TransactionDto } from "@/lib/queries.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
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
  emptyLabel,
}: {
  transactions: TransactionDto[];
  locale: Locale;
  emptyLabel?: string;
}) {
  if (transactions.length === 0) {
    // The fallback lives in the body rather than as a default parameter value:
    // a default cannot reference another parameter's catalog entry.
    return (
      <p className="py-6 text-sm text-[var(--color-muted-foreground)]">
        {emptyLabel ?? MESSAGES[locale].transactions.empty}
      </p>
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