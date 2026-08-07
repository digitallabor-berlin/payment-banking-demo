import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { relayDcApiResponse } from "@/lib/dc-api-relay.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ response: z.string().min(1) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await relayDcApiResponse(getDb(), getFoundry(), id, parsed.data.response);

  if (!result.ok) {
    const status = result.reason === "foundry_unavailable" ? 502 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // 204: the verdict reaches the UI through the poll already running.
  return new NextResponse(null, { status: 204 });
}