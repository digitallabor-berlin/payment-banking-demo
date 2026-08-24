import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/AccountPanel.js";
import { AgeCredentialTile } from "@/components/AgeCredentialTile.js";
import { AppHeader } from "@/components/AppHeader.js";
import { CardTile } from "@/components/CardTile.js";
import { TransactionLedger } from "@/components/TransactionLedger.js";
import { WeroCredentialTile } from "@/components/WeroCredentialTile.js";
import { getDb } from "@/db/index.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { getLocale } from "@/lib/i18n/server.js";
import {
  getAgeCredentialState,
  getWeroCredentialState,
  listAccounts,
  listCards,
  listTransactions,
} from "@/lib/queries.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const locale = await getLocale();
  const t = MESSAGES[locale];
  const db = getDb();
  const accounts = listAccounts(db, session.userId);
  const cards = listCards(db, session.userId);
  const recent = listTransactions(db, session.userId, 5, 0);
  const ageCredential = getAgeCredentialState(db, session.userId);
  const wero = getWeroCredentialState(db, session.userId);
  // Wero is payable, and `processPayment` resolves an account through a card, so
  // a Wero credential cannot be issued without one to hang the row on. No card,
  // no tile — rather than a tile whose button can only ever fail.
  const weroCardId = cards[0]?.id;

  return (
    <>
      <AppHeader
        displayName={session.displayName}
        active="dashboard"
        locale={locale}
      />

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8">
        <h1 className="page-title">
          {t.dashboard.greeting(session.displayName)}
        </h1>

        <section className="grid gap-4 sm:grid-cols-2">
          {accounts.map((account) => (
            <AccountPanel key={account.id} account={account} locale={locale} />
          ))}
        </section>

        <section>
          <h2 className="eyebrow">{t.dashboard.cards}</h2>
          <div className="mt-3 space-y-4">
            {cards.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                holder={session.displayName}
                iban={
                  accounts.find((account) => account.id === card.accountId)
                    ?.iban
                }
                locale={locale}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="eyebrow">{t.dashboard.credentials}</h2>
          <div className="mt-3 space-y-4">
            {weroCardId ? (
              <WeroCredentialTile
                cardId={weroCardId}
                credentialState={wero.state}
                locale={locale}
              />
            ) : null}
            <AgeCredentialTile
              credentialState={ageCredential.state}
              formats={ageCredential.formats}
              locale={locale}
            />
          </div>
        </section>

        <section className="panel p-6">
          <div className="panel-divider flex items-baseline justify-between gap-4 border-t-0 pb-4">
            <h2 className="panel-title">{t.dashboard.recentTransactions}</h2>
            <Link
              href="/transactions"
              className="text-sm font-semibold text-[var(--color-primary)] hover:underline"
            >
              {t.dashboard.showAll}
            </Link>
          </div>

          <TransactionLedger transactions={recent} locale={locale} />
        </section>
      </main>
    </>
  );
}
