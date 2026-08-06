import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader.js";
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
    <>
      <SiteHeader />

      <main className="mx-auto max-w-xl px-5 py-14">
        <p className="eyebrow">Receipt</p>
        <h1 className="display mt-2 text-4xl">Paid. Thanks, {order.customerName}.</h1>
        <p className="mt-3 text-[15px] text-[var(--color-muted-foreground)]">
          Your bank has settled this order. A copy is on its way to your inbox.
        </p>

        {/*
          A receipt, laid out as one: amount dominant, references in mono
          beneath it, hairline rules between rows.
        */}
        <div className="surface mt-8 p-6">
          <div className="rule flex items-baseline justify-between gap-4 pb-4">
            <span className="eyebrow">Total paid</span>
            <span className="display text-4xl">{formatEuroCents(order.totalCents)}</span>
          </div>

          <dl className="mt-4 space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="eyebrow">Order</dt>
              <dd className="data">{order.id}</dd>
            </div>
            {order.bankTxId ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="eyebrow">Bank reference</dt>
                <dd className="data break-all text-right">{order.bankTxId}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        <VerificationDetails checks={order.checks} />

        <Link href="/" className="btn btn-solid mt-8 px-5 py-3">
          Back to the shop
        </Link>
      </main>
    </>
  );
}