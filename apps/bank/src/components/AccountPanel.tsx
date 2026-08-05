import type { AccountDto } from "@/lib/queries.js";
import { formatEuroCents, formatIban } from "@/lib/format.js";

export function AccountPanel({ account }: { account: AccountDto }) {
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold text-[var(--color-muted-foreground)]">
        Girokonto
      </h2>
      <p className="mt-1 font-mono text-xs text-[var(--color-muted-foreground)]">
        {formatIban(account.iban)}
      </p>
      <p className="mt-3 text-3xl font-bold tabular-nums">
        {formatEuroCents(account.balanceCents)}
      </p>
      <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
        Verfügbarer Betrag
      </p>
    </section>
  );
}