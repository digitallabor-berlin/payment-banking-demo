import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { listTransactions } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const GET = withSession(async (session, request) => {
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    limit: url.searchParams.get("limit") ?? undefined,
    offset: url.searchParams.get("offset") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  return NextResponse.json({
    transactions: listTransactions(
      getDb(),
      session.userId,
      parsed.data.limit,
      parsed.data.offset,
    ),
  });
});