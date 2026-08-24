import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/AccountPanel.js";
import { AgeCredentialTile } from "@/components/AgeCredentialTile.js";
import { AppHeader } from "@/components/AppHeader.js";
import { CardTile } from "@/components/CardTile.js";
import { SparkassenAuthTile } from "@/components/SparkassenAuthTile.js";
import { TransactionLedger } from "@/components/TransactionLedger.js";
import { WeroCredentialTile } from "@/components/WeroCredentialTile.js";
import { getDb } from "@/db/index.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { getLocale } from "@/lib/i18n/server.js";
import {
  getAgeCredentialState,
  getAuthenticatorCredentialState,
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
  const authenticator = getAuthenticatorCredentialState(db, session.userId);
  const wero = getWeroCredentialState(db, session.userId);
  // Wero is payable, and `processPayment` resolves an account through a card, so
  // a Wero credential cannot be issued without one to hang the row on. No card,
  // no tile — rather than a tile whose button can only ever fail.
  const weroCard = cards[0];

  /**
   * Both faces print the account's IBAN, so the lookup is named once rather
   * than written twice — the girocard and Wero are the same account rendered as
   * two instruments, and a second copy of this could only ever drift.
   */
  const ibanFor = (accountId: string) =>
    accounts.find((account) => account.id === accountId)?.iban;

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

        {/* Payment instruments, not cards: Wero is drawn on the account rather
            than on a card, so the heading names what these do instead of what
            they are. */}
        <section>
          <h2 className="eyebrow">{t.dashboard.payments}</h2>
          <div className="mt-3 space-y-4">
            {cards.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                holder={session.displayName}
                iban={ibanFor(card.accountId)}
                locale={locale}
              />
            ))}
            {weroCard ? (
              <WeroCredentialTile
                cardId={weroCard.id}
                credentialState={wero.state}
                holder={session.displayName}
                iban={ibanFor(weroCard.accountId)}
                locale={locale}
              />
            ) : null}
          </div>
        </section>

        <section>
          <h2 className="eyebrow">{t.dashboard.credentials}</h2>
          <div className="mt-3 space-y-4">
            <AgeCredentialTile
              credentialState={ageCredential.state}
              formats={ageCredential.formats}
              locale={locale}
            />
            {/* Needs no card, unlike the Wero tile above: this credential is
                not payable, so there is no account to resolve through and the
                tile is unconditional. */}
            <SparkassenAuthTile
              credentialState={authenticator.state}
              holder={session.displayName}
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
