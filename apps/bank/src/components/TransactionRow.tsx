import type { TransactionDto } from "@/lib/queries.js";
import { formatEuroCents } from "@/lib/format.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { EuStars } from "./EuStars.js";

export function TransactionRow({
  transaction,
  locale,
}: {
  transaction: TransactionDto;
  locale: Locale;
}) {
  const isDebit = transaction.amountCents < 0;

  return (
    <li className="ledger-row py-3">
      <div className="min-w-0">
        <p className="ledger-counterparty truncate">
          {transaction.counterparty}
        </p>
        <p className="ledger-meta mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate">{transaction.reference}</span>
          {transaction.paidWithWallet ? (
            // The wallet mark rather than a grey pill: it is the same twelve
            // stars that appear on the card, so the connection between "I
            // added this card" and "I paid with it" is visible at a glance.
            <span className="badge badge-wallet px-2 py-0.5">
              <EuStars className="h-3 w-3" />
              EUDI Wallet
            </span>
          ) : null}
        </p>
      </div>

      <span
        className="ledger-amount"
        data-direction={isDebit ? "debit" : "credit"}
      >
        {formatEuroCents(transaction.amountCents, locale)}
      </span>
    </li>
  );
}
