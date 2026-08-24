import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { relayDcApiResponse } from "@/lib/dc-api-relay.js";
import { getFoundry } from "@/lib/foundry.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ response: z.string().min(1) });

/**
 * Relays the wallet's encrypted JWE to foundry.
 *
 * Exists only because foundry's `dc-api-response` endpoint is admin
 * authenticated and the admin key must never reach a browser.
 *
 * Returns 204 and discards foundry's verdict: the verdict reaches the UI
 * through the poll that is already running, so there is one state path rather
 * than two.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const { id } = await context.params;
  const result = await relayDcApiResponse(
    getDb(),
    getFoundry(),
    id,
    parsed.data.response,
  );

  if (!result.ok) {
    const status = result.reason === "foundry_unavailable" ? 502 : 404;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return new NextResponse(null, { status: 204 });
}