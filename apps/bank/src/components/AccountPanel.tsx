import type { AccountDto } from "@/lib/queries.js";
import { formatEuroCents, formatIban, splitEuroCents } from "@/lib/format.js";
import type { Locale } from "@/lib/i18n/locale.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import type { DcApiForm } from "@/lib/transport.js";
import { AccountLimitRow } from "./AccountLimitRow.js";

export function AccountPanel({
  account,
  locale,
  dcApiForm,
}: {
  account: AccountDto;
  locale: Locale;
  /**
   * Which DC API wire form a limit change should ask for, read from
   * `?dcapi=` server-side by the page and threaded through. NOT read with
   * `useSearchParams` in the dialog: a client read there would need a Suspense
   * boundary, and the wallet button must have the answer before the click.
   */
  dcApiForm: DcApiForm;
}) {
  const { sign, major, minor } = splitEuroCents(account.balanceCents, locale);

  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="eyebrow">{MESSAGES[locale].account.type}</h2>
          <p className="mono mt-1.5 text-xs text-[var(--color-muted-foreground)]">
            {formatIban(account.iban)}
          </p>
        </div>
        <span className="badge badge-neutral shrink-0 px-2 py-1">
          {account.currency}
        </span>
      </div>

      {/*
        Euros dominate, cents and the currency mark step back — the magnitude
        is what a customer is looking for, and setting all seven characters at
        one size makes them hunt for it.
      */}
      <p className="figure mt-6">
        <span className="figure-major">
          {sign}
          {major}
        </span>
        <span className="figure-minor">,{minor}</span>
        <span className="figure-currency">€</span>
      </p>

      <p className="eyebrow mt-3">{MESSAGES[locale].account.available}</p>

      {/*
        The limit is a property of the account, so it belongs on the account's
        own panel — nothing new appears on the dashboard. Separated by a rule
        because it is a different fact from the balance, not more of it.
      */}
      <div className="panel-divider mt-6 flex items-baseline justify-between gap-4 pt-4">
        <div className="min-w-0">
          <p className="eyebrow">{MESSAGES[locale].limits.dailyTransfer}</p>
          <p className="mt-1 text-base font-semibold">
            {formatEuroCents(account.dailyLimitCents, locale)}
          </p>
        </div>
        <AccountLimitRow
          accountId={account.id}
          dailyLimitCents={account.dailyLimitCents}
          locale={locale}
          dcApiForm={dcApiForm}
        />
      </div>
    </section>
  );
}
