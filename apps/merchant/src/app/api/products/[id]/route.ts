import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getProduct } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const product = getProduct(getDb(), id);
  if (!product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ product });
}