import Link from "next/link";
import { notFound } from "next/navigation";
import { VerificationDetails } from "@/components/VerificationDetails.js";
import { getDb } from "@/db/index.js";
import { formatEuroCents } from "@/lib/format.js";
import { getOrderView } from "@/lib/order-view.js";

export const dynamic = "force-dynamic";

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { orderId } = await searchParams;
  if (!orderId) notFound();

  const order = getOrderView(getDb(), orderId);
  if (!order) notFound();

  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <div className="success-card p-8 text-center">
        <div className="text-5xl" aria-hidden="true">
          ✅
        </div>
        <h1 className="mt-4 text-2xl font-bold">Payment successful</h1>
        <p className="mt-1 text-[var(--color-muted-foreground)]">
          Thanks, {order.customerName}. Your order is confirmed.
        </p>

        <dl className="mt-6 space-y-2 text-left text-sm">
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted-foreground)]">Order</dt>
            <dd className="font-mono">{order.id}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-[var(--color-muted-foreground)]">Total</dt>
            <dd className="font-semibold">{formatEuroCents(order.totalCents)}</dd>
          </div>
          {order.bankTxId ? (
            <div className="flex justify-between">
              <dt className="text-[var(--color-muted-foreground)]">Bank reference</dt>
              <dd className="font-mono text-xs">{order.bankTxId}</dd>
            </div>
          ) : null}
        </dl>

        <VerificationDetails checks={order.checks} />

        <Link
          href="/"
          className="mt-8 inline-block rounded-[var(--radius)] bg-[var(--color-brand)] px-5 py-2.5 font-semibold text-white"
        >
          Continue shopping
        </Link>
      </div>
    </main>
  );
}