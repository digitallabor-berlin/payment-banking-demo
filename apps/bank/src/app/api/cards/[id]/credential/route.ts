import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { startIssuance } from "@/lib/issuance.js";
import { requireSession, UnauthorizedError } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let userId: string;
  try {
    userId = (await requireSession()).userId;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    }
    throw error;
  }

  const { id: cardId } = await context.params;
  const result = await startIssuance(getDb(), getFoundry(), userId, cardId);

  if (!result.ok) {
    const status = result.reason === "card_not_found" ? 404 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({
    sessionId: result.sessionId,
    offerUri: result.offerUri,
    dcApiOffer: result.dcApiOffer,
  });
}