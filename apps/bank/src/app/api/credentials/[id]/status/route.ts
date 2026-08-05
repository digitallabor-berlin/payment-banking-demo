import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { getFoundry } from "@/lib/foundry.js";
import { refreshIssuanceState } from "@/lib/issuance.js";
import { requireSession, UnauthorizedError } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export async function GET(
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

  const { id } = await context.params;
  const result = await refreshIssuanceState(getDb(), getFoundry(), userId, id);

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 404 });
  }
  return NextResponse.json({ state: result.state });
}