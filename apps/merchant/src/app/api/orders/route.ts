import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { createOrder } from "@/lib/orders.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1),
  customer: z.object({ name: z.string().min(1), email: z.string().email() }),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = createOrder(getDb(), parsed.data.items, parsed.data.customer);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  return NextResponse.json(
    { orderId: result.orderId, totalCents: result.totalCents },
    { status: 201 },
  );
}