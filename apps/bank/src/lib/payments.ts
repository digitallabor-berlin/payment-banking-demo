import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { accounts, cards, credentials, transactions } from "../db/schema.js";
import { isPaymentCredentialType } from "./credential-types.js";

export interface ProcessPaymentInput {
  credentialId: string;
  amountCents: number;
  currency: string;
  merchant: string;
  reference: string;
  idempotencyKey: string;
}

export type ProcessPaymentResult =
  | { ok: true; bankTxId: string; newBalanceCents: number }
  | {
      ok: false;
      reason:
        | "unknown_credential"
        | "credential_not_active"
        | "insufficient_funds";
    };

/**
 * The merchant→bank debit (spec §6.2 steps 8–9). Checked in order: an existing
 * idempotency_key short-circuits everything below it, so a repeat request
 * with the same key never re-evaluates credential state or balance — it just
 * replays the original result.
 */
export function processPayment(
  db: Db,
  input: ProcessPaymentInput,
  now: number = Date.now(),
): ProcessPaymentResult {
  const existing = db
    .select()
    .from(transactions)
    .where(eq(transactions.idempotencyKey, input.idempotencyKey))
    .get();
  if (existing) {
    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, existing.accountId))
      .get();
    return {
      ok: true,
      bankTxId: existing.id,
      newBalanceCents: account?.balanceCents ?? 0,
    };
  }

  const credential = db
    .select()
    .from(credentials)
    .where(eq(credentials.credentialId, input.credentialId))
    .get();
  if (!credential) return { ok: false, reason: "unknown_credential" };

  // An age attestation is not a payment instrument. Reported as
  // unknown_credential rather than as a distinct reason: this is a
  // server-to-server call behind a shared secret, and the merchant maps every
  // credential problem to one user-facing message anyway.
  //
  // Asks the predicate rather than naming one type: the girocard is issued in
  // two formats and both authorize money to move. Whichever claim carried the
  // value that got us here — `credential_id` on the DPC, `psu_id` on the
  // Sparkasse card — issuance stored it in the one column the SELECT above
  // reads, so there is one lookup and one guard rather than a path per format.
  if (!isPaymentCredentialType(credential.credentialTypeId)) {
    return { ok: false, reason: "unknown_credential" };
  }

  if (credential.state !== "active")
    return { ok: false, reason: "credential_not_active" };

  // cardId is nullable since the age credential landed. The narrowing is what
  // the next line needs, and closing the same hole twice is deliberate: this
  // one is enforced by the compiler, the one above by the type id.
  if (!credential.cardId) return { ok: false, reason: "unknown_credential" };

  const card = db
    .select()
    .from(cards)
    .where(eq(cards.id, credential.cardId))
    .get();
  if (!card) return { ok: false, reason: "unknown_credential" };

  const account = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, card.accountId))
    .get();
  if (!account) return { ok: false, reason: "unknown_credential" };

  if (account.balanceCents < input.amountCents)
    return { ok: false, reason: "insufficient_funds" };

  const bankTxId = `tx_${randomUUID()}`;
  const newBalanceCents = account.balanceCents - input.amountCents;

  try {
    return db.transaction((tx) => {
      tx.update(accounts)
        .set({ balanceCents: newBalanceCents })
        .where(eq(accounts.id, account.id))
        .run();
      tx.insert(transactions)
        .values({
          id: bankTxId,
          accountId: account.id,
          amountCents: -input.amountCents,
          currency: input.currency,
          counterparty: input.merchant,
          reference: input.reference,
          bookedAt: now,
          credentialId: input.credentialId,
          idempotencyKey: input.idempotencyKey,
        })
        .run();
      return { ok: true, bankTxId, newBalanceCents } as const;
    });
  } catch (error) {
    // A concurrent request with the same idempotency key won the race between
    // our SELECT above and this INSERT — the UNIQUE constraint on
    // idempotency_key caught it. Not separately exercised by a test: a
    // single-threaded vitest run cannot produce a genuine concurrent race,
    // only the sequential case above (which the top-of-function check
    // already covers). Re-fetch and return the winner's result rather than
    // throwing, so this path is still idempotent under real concurrency.
    const raced = db
      .select()
      .from(transactions)
      .where(eq(transactions.idempotencyKey, input.idempotencyKey))
      .get();
    if (raced) {
      const racedAccount = db
        .select()
        .from(accounts)
        .where(eq(accounts.id, raced.accountId))
        .get();
      return {
        ok: true,
        bankTxId: raced.id,
        newBalanceCents: racedAccount?.balanceCents ?? 0,
      };
    }
    throw error;
  }
}
