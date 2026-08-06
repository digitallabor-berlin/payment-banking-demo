import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getOrderView } from "@/lib/order-view.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const order = getOrderView(getDb(), id);
  if (!order) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ order });
}