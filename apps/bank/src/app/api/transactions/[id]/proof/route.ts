import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { getTransactionProof } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

/**
 * The stored PaSO proof package for one transaction.
 *
 * The body is `getTransactionProof`'s return value passed straight through, NOT
 * re-assembled from its members. That function carries a written-out
 * `TransactionProofBody` annotation, so a member added there cannot be silently
 * dropped here — which is exactly how `dcApiProtocol` went missing from the
 * merchant's payment-session route (6e997da).
 *
 * Absent, unowned and nonexistent all answer 404. A transaction id is
 * guessable and this payload is a holder's wallet presentation, so
 * "this is not yours" must not be distinguishable from "this does not exist".
 *
 * `withSession` hands the handler `(session, request)` and nothing else, so the
 * dynamic segment is read from the URL rather than from a `params` argument.
 * The path is `/api/transactions/{id}/proof`, so the id is the second-to-last
 * segment.
 */
export const GET = withSession(async (session, request) => {
  const id = new URL(request.url).pathname.split("/").at(-2) ?? "";
  const body = getTransactionProof(getDb(), session.userId, id);
  if (!body) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(body);
});