import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { OrderSummary } from "@/components/OrderSummary.js";
import { PaymentScreen } from "@/components/PaymentScreen.js";
import { SiteHeader } from "@/components/SiteHeader.js";
import { getDb } from "@/db/index.js";
import { orders } from "@/db/schema.js";
import { env } from "@/env.js";
import { loadCheckoutSession } from "@/lib/checkout-session.js";
import { listOrderLines } from "@/lib/order-lines.js";

export const dynamic = "force-dynamic";

/**
 * The standalone payment route. Kept, not deleted: a deep link, a reload in a
 * different browser, or a shared URL has no client cart to render behind the
 * sheet, so /checkout's modal cannot serve those cases.
 *
 * No `onClose` is passed — this is a server component and cannot hand a function
 * across the boundary. PaymentScreen falls back to navigating home, which is the
 * right behaviour here: there is no page underneath to return to.
 */
export default async function PayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const db = getDb();

  const session = loadCheckoutSession(db, sessionId);
  if (!session) notFound();

  const order = db.select().from(orders).where(eq(orders.id, session.orderId)).get();
  if (!order) notFound();

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-md px-5 py-12">
        <OrderSummary
          lines={listOrderLines(db, order.id)}
          totalCents={order.totalCents}
          customerName={order.customerName}
        />
      </main>

      <PaymentScreen {...session} merchantName={env.MERCHANT_NAME} />
    </>
  );
}