import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader.js";
import { TransactionLedger } from "@/components/TransactionLedger.js";
import { getDb } from "@/db/index.js";
import { MESSAGES } from "@/lib/i18n/messages.js";
import { getLocale } from "@/lib/i18n/server.js";
import { listTransactions } from "@/lib/queries.js";
import { getSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const locale = await getLocale();
  const t = MESSAGES[locale];
  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Fetch one extra row to learn whether a next page exists.
  const rows = listTransactions(getDb(), session.userId, PAGE_SIZE + 1, offset);
  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  return (
    <>
      <AppHeader
        displayName={session.displayName}
        active="transactions"
        locale={locale}
      />

      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="page-title">{t.transactions.title}</h1>
          <span className="eyebrow">{t.transactions.page(page)}</span>
        </div>

        <section className="panel mt-5 p-6">
          <TransactionLedger
            transactions={visible}
            locale={locale}
            emptyLabel={t.transactions.emptyMore}
          />
        </section>

        <nav
          className="mt-5 flex items-center justify-between gap-4"
          aria-label={t.transactions.pagination}
        >
          {page > 1 ? (
            <Link href={`/transactions?page=${page - 1}`} className="btn btn-outline px-4 py-2">
              {t.transactions.newer}
            </Link>
          ) : (
            <span />
          )}
          {hasNext ? (
            <Link href={`/transactions?page=${page + 1}`} className="btn btn-outline px-4 py-2">
              {t.transactions.older}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </main>
    </>
  );
}