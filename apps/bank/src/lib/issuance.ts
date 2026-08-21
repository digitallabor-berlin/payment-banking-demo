import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { accounts, cards, credentials } from "../db/schema.js";
import { mintJoinKey } from "./credential-id.js";
import {
  sendsDpcDisplayMetadata,
  type PaymentCredentialTypeId,
} from "./credential-types.js";
import {
  buildCredentialResponseDisplay,
  buildOfferDisplay,
  cardArtUrl,
} from "./display-metadata.js";
import { buildPaymentClaims } from "./payment-claims.js";
import { env } from "../env.js";

export { DPC_CREDENTIAL_TYPE_ID } from "./credential-types.js";

export type StartIssuanceResult =
  | { ok: true; sessionId: string; offerUri: string; dcApiOffer: unknown }
  | { ok: false; reason: "card_not_found" | "foundry_unavailable" };

export type RefreshResult =
  | { ok: true; state: "offered" | "active" | "failed" }
  | { ok: false; reason: "not_found" };

/**
 * Spec 6.1 steps 2–5. The credentials row is written BEFORE foundry is called,
 * so a failed offer leaves a visible `failed` row rather than nothing at all.
 *
 * Issues the same girocard in whichever format `credentialTypeId` names. The
 * two differ in three places and nowhere else — the join key's shape, the claim
 * set, and whether the DPC display metadata may be attached — so this is one
 * function with three guarded branches rather than a sibling of the
 * `startAvIssuance` kind. That one is a sibling because it shares a shape and
 * not a body; these two share the body.
 *
 * `credentialTypeId` is required rather than defaulted to the DPC. A defaulted
 * format would mean a caller that forgot to say which one it wanted silently
 * got a payment credential of the wrong shape, and the schema already learned
 * that lesson once — see `credentials.credentialTypeId`.
 */
export async function startIssuance(
  db: Db,
  client: FoundryClient,
  userId: string,
  cardId: string,
  credentialTypeId: PaymentCredentialTypeId,
  now: number = Date.now(),
): Promise<StartIssuanceResult> {
  // Joined to `accounts` for the IBAN alone: `card.last_four` in the DPC display
  // metadata is the IBAN's last four digits, NOT `panLast4`.
  //
  // An INNER join can only narrow the result if a card outlives its account, and
  // that is currently unreachable: `cards.accountId` is `notNull().references()`,
  // `db/index.ts` enables `foreign_keys = ON`, and nothing declares
  // `ON DELETE CASCADE`. Adding an account-deletion path would silently turn a
  // working issuance into `card_not_found`.
  const row = db
    .select({ card: cards, iban: accounts.iban })
    .from(cards)
    .innerJoin(accounts, eq(cards.accountId, accounts.id))
    .where(and(eq(cards.id, cardId), eq(cards.userId, userId)))
    .get();

  // Same answer for "no such card" and "not your card": never confirm existence.
  if (!row) return { ok: false, reason: "card_not_found" };
  const { card, iban } = row;

  const rowId = `cred_${randomUUID()}`;
  // The wallet will disclose this at checkout under whichever claim name the
  // format uses — `credential_id` on the DPC, `psu_id` on the Sparkasse card —
  // and `processPayment` looks it up in this one column either way.
  const joinKey = mintJoinKey(credentialTypeId);

  db.insert(credentials)
    .values({
      id: rowId,
      userId,
      cardId: card.id,
      credentialTypeId,
      credentialId: joinKey,
      foundryTxId: null,
      state: "offered",
      issuedAt: null,
      createdAt: now,
    })
    .run();

  try {
    // Built inside the try on purpose: both `buildCredentialResponseDisplay`
    // and `buildPaymentClaims` throw for an IBAN whose last four characters are
    // not digits, and that must degrade to a `failed` row exactly as a foundry
    // rejection does rather than escape as an unhandled 500. `db/seed.test.ts`
    // asserts the fixtures satisfy the invariant, so this is unreachable for
    // seeded data.
    const claims = buildPaymentClaims(credentialTypeId, {
      card,
      iban,
      joinKey,
      // Sent, never stored. Nothing resolves a credential by its `sub`.
      subjectId: randomUUID(),
    });

    // The two display arrays are attached ONLY for the DPC. foundry gates them
    // on the resolved type's vct and rejects them outright for anything else,
    // and a rejection is not a card missing its artwork — the offer is never
    // created and this lands in the catch below as a `failed` row. The
    // Sparkasse card's wallet appearance therefore comes entirely from
    // foundry's own static `display:` config, exactly as the age credential's
    // does.
    const display = sendsDpcDisplayMetadata(credentialTypeId)
      ? {
          offer_display: buildOfferDisplay(card),
          credential_response_display: buildCredentialResponseDisplay({
            card,
            iban,
            cardArtUrl: cardArtUrl(env.BANK_PUBLIC_URL),
          }),
        }
      : {};

    const offer = await client.createIssuanceOffer({
      credential_type_id: credentialTypeId,
      claims,
      ...display,
    });

    db.update(credentials)
      .set({ foundryTxId: offer.transaction_id })
      .where(eq(credentials.id, rowId))
      .run();

    // Two renderings of ONE offer: the deep link and the DC API payload.
    // dcApiOffer is deliberately not persisted — the offer is already recorded
    // by foundryTxId, so a column would duplicate state (spec 2).
    return {
      ok: true,
      sessionId: rowId,
      offerUri: offer.credential_offer_uri,
      dcApiOffer: offer.dc_api_offer,
    };
  } catch {
    db.update(credentials)
      .set({ state: "failed" })
      .where(eq(credentials.id, rowId))
      .run();
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
    .where(
      and(eq(credentials.id, credentialRowId), eq(credentials.userId, userId)),
    )
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
