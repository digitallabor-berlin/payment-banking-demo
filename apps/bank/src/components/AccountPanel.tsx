import type { AccountDto } from "@/lib/queries.js";
import { formatIban, splitEuroCents } from "@/lib/format.js";

export function AccountPanel({ account }: { account: AccountDto }) {
  const { sign, major, minor } = splitEuroCents(account.balanceCents);

  return (
    <section className="panel p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="eyebrow">Girokonto</h2>
          <p className="mono mt-1.5 text-xs text-[var(--color-muted-foreground)]">
            {formatIban(account.iban)}
          </p>
        </div>
        <span className="badge badge-neutral shrink-0 px-2 py-1">{account.currency}</span>
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

      <p className="eyebrow mt-3">Verfügbarer Betrag</p>
    </section>
  );
}