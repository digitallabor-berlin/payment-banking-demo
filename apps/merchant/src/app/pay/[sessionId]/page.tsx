import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { PaymentScreen } from "@/components/PaymentScreen.js";
import { getDb } from "@/db/index.js";
import { orders, paymentSessions } from "@/db/schema.js";
import { env } from "@/env.js";

export const dynamic = "force-dynamic";

export default async function PayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const db = getDb();

  const session = db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.id, sessionId))
    .get();
  if (!session) notFound();

  const order = db.select().from(orders).where(eq(orders.id, session.orderId)).get();
  if (!order) notFound();

  return (
    <PaymentScreen
      sessionId={session.id}
      orderId={order.id}
      amountCents={order.totalCents}
      merchantName={env.MERCHANT_NAME}
      openid4vpUri={session.openid4vpUri ?? session.requestUri ?? ""}
      transport={session.transport}
      ageRequested={session.namedQueryRef === "dpc_av"}
      dcApiRequest={session.dcApiRequestJson ? JSON.parse(session.dcApiRequestJson) : null}
      initialState={session.state}
      initialFailureReason={session.failureReason ?? undefined}
    />
  );
}