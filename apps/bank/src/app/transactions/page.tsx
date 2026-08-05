import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader.js";
import { TransactionRow } from "@/components/TransactionRow.js";
import { getDb } from "@/db/index.js";
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

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Fetch one extra row to learn whether a next page exists.
  const rows = listTransactions(getDb(), session.userId, PAGE_SIZE + 1, offset);
  const hasNext = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);

  return (
    <>
      <AppHeader displayName={session.displayName} active="transactions" />

      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-lg font-semibold">Umsätze</h1>

        <section className="panel p-5">
          <ul>
            {visible.map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </ul>
          {visible.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-muted-foreground)]">
              Keine weiteren Umsätze.
            </p>
          ) : null}
        </section>

        <nav className="mt-4 flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link
              href={`/transactions?page=${page - 1}`}
              className="font-medium text-[var(--color-primary)]"
            >
              ← Neuer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[var(--color-muted-foreground)]">Seite {page}</span>
          {hasNext ? (
            <Link
              href={`/transactions?page=${page + 1}`}
              className="font-medium text-[var(--color-primary)]"
            >
              Älter →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </main>
    </>
  );
}