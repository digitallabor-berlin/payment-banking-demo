import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { listProducts } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ products: listProducts(getDb()) });
}