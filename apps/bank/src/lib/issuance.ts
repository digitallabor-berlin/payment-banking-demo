import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { cards, credentials } from "../db/schema.js";
import { mintCredentialId } from "./credential-id.js";

/** The credential type id configured in foundry (spec 3). */
export const DPC_CREDENTIAL_TYPE_ID = "com.emvco.dpc.card";

export type StartIssuanceResult =
  | { ok: true; sessionId: string; offerUri: string }
  | { ok: false; reason: "card_not_found" | "foundry_unavailable" };

export type RefreshResult =
  | { ok: true; state: "offered" | "active" | "failed" }
  | { ok: false; reason: "not_found" };

/**
 * Spec 6.1 steps 2–5. The credentials row is written BEFORE foundry is called,
 * so a failed offer leaves a visible `failed` row rather than nothing at all.
 */
export async function startIssuance(
  db: Db,
  client: FoundryClient,
  userId: string,
  cardId: string,
  now: number = Date.now(),
): Promise<StartIssuanceResult> {
  const card = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .get();

  // Same answer for "no such card" and "not your card": never confirm existence.
  if (!card) return { ok: false, reason: "card_not_found" };

  const rowId = `cred_${randomUUID()}`;
  const credentialId = mintCredentialId();

  db.insert(credentials)
    .values({
      id: rowId,
      userId,
      cardId: card.id,
      credentialId,
      foundryTxId: null,
      state: "offered",
      issuedAt: null,
      createdAt: now,
    })
    .run();

  try {
    const offer = await client.createIssuanceOffer({
      credential_type_id: DPC_CREDENTIAL_TYPE_ID,
      claims: {
        credential_id: credentialId,
        network: card.network,
        card_id: card.id,
      },
    });

    db.update(credentials)
      .set({ foundryTxId: offer.transaction_id })
      .where(eq(credentials.id, rowId))
      .run();

    return { ok: true, sessionId: rowId, offerUri: offer.credential_offer_uri };
  } catch {
    db.update(credentials).set({ state: "failed" }).where(eq(credentials.id, rowId)).run();
    return { ok: false, reason: "foundry_unavailable" };
  }
}

/**
 * Spec 6.1 steps 8–9. Polled by the browser. A foundry outage deliberately
 * leaves the row `offered` so a later poll can still succeed — only the client's
 * consecutive-failure counter decides when to give up.
 */
export async function refreshIssuanceState(
  db: Db,
  client: FoundryClient,
  userId: string,
  credentialRowId: string,
): Promise<RefreshResult> {
  const row = db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, credentialRowId), eq(credentials.userId, userId)))
    .get();

  if (!row) return { ok: false, reason: "not_found" };

  // Terminal states need no further foundry traffic.
  if (row.state !== "offered") return { ok: true, state: row.state };
  if (!row.foundryTxId) return { ok: true, state: row.state };

  try {
    const status = await client.getIssuanceStatus(row.foundryTxId);
    if (status.state === "issued") {
      db.update(credentials)
        .set({ state: "active", issuedAt: Date.now() })
        .where(eq(credentials.id, row.id))
        .run();
      return { ok: true, state: "active" };
    }
    return { ok: true, state: "offered" };
  } catch {
    return { ok: true, state: "offered" };
  }
}