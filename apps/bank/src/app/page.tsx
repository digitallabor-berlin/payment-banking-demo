import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/AccountPanel.js";
import { AppHeader } from "@/components/AppHeader.js";
import { CardTile } from "@/components/CardTile.js";
import { TransactionRow } from "@/components/TransactionRow.js";
import { getDb } from "@/db/index.js";
import { listAccounts, listCards, listTransactions } from "@/lib/queries.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const db = getDb();
  const accounts = listAccounts(db, session.userId);
  const cards = listCards(db, session.userId);
  const recent = listTransactions(db, session.userId, 5, 0);

  return (
    <>
      <AppHeader displayName={session.displayName} active="dashboard" />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((account) => (
            <AccountPanel key={account.id} account={account} />
          ))}
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Karten</h2>
          {cards.map((card) => (
            <CardTile key={card.id} card={card} />
          ))}
        </section>

        <section className="panel p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Letzte Umsätze</h2>
            <Link
              href="/transactions"
              className="text-sm font-medium text-[var(--color-primary)]"
            >
              Alle anzeigen
            </Link>
          </div>
          <ul>
            {recent.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}