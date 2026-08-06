import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { orders, paymentSessions } from "@/db/schema.js";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const db = getDb();

  const session = db.select().from(paymentSessions).where(eq(paymentSessions.id, id)).get();
  if (!session) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Cancelling a session that already completed must not un-charge it.
  if (session.state === "completed") {
    return NextResponse.json({ error: "already_completed" }, { status: 409 });
  }

  db.update(paymentSessions)
    .set({ state: "failed", failureReason: "cancelled" })
    .where(eq(paymentSessions.id, id))
    .run();

  // Unlike every other failure, an explicit cancel is the user saying they do
  // not want this order at all — so the order becomes `cancelled` rather than
  // staying `pending` for retry (spec §5.2).
  db.update(orders).set({ status: "cancelled" }).where(eq(orders.id, session.orderId)).run();

  return NextResponse.json({ ok: true });
}