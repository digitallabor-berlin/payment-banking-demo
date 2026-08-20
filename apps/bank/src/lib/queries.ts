import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { accounts, cards, credentials, transactions } from "../db/schema.js";
import { AV_CREDENTIAL_TYPE_ID } from "./credential-types.js";

export interface AccountDto {
  id: string;
  iban: string;
  currency: string;
  balanceCents: number;
}

/** "none" also covers a card whose only credential attempt failed. */
export type CardCredentialState = "none" | "offered" | "active";

export interface CardDto {
  id: string;
  accountId: string;
  panLast4: string;
  network: string;
  cardAlias: string;
  credentialState: CardCredentialState;
  credentialRowId: string | null;
}

export interface AgeCredentialDto {
  state: CardCredentialState;
  credentialRowId: string | null;
}

export interface TransactionDto {
  id: string;
  amountCents: number;
  currency: string;
  counterparty: string;
  reference: string;
  bookedAt: number;
  paidWithWallet: boolean;
}

export function listAccounts(db: Db, userId: string): AccountDto[] {
  return db
    .select({
      id: accounts.id,
      iban: accounts.iban,
      currency: accounts.currency,
      balanceCents: accounts.balanceCents,
    })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .all();
}

/**
 * Which of a subject's non-failed credential rows the UI should describe.
 *
 * An `active` row outranks an `offered` one; within one state the newest wins.
 *
 * The plain "newest wins" rule this replaces was safe only while the UI
 * forbade a second issuance. The bank now offers "add again" — nothing behind
 * the UI ever objected — and since no code path in this project clears an
 * `offered` row, one abandoned re-issue would otherwise outrank the live
 * credential forever and the tile would report "Not in wallet" for a
 * credential that is demonstrably in the wallet.
 *
 * A credential in the wallet is a fact; an offer is an intention. A re-issue
 * supersedes its predecessor when it becomes active itself, which is what the
 * within-state ordering preserves.
 *
 * Callers must pass rows already filtered to `offered | active` and ordered
 * newest-first, which is why this takes rows rather than querying: the two
 * call sites differ in how they scope the query (by card, by user and type)
 * but must not differ in this rule.
 */
function pickLiveCredential<T extends { state: string }>(
  newestFirst: T[],
): T | undefined {
  return newestFirst.find((row) => row.state === "active") ?? newestFirst[0];
}

export function listCards(db: Db, userId: string): CardDto[] {
  const rows = db.select().from(cards).where(eq(cards.userId, userId)).all();

  return rows.map((card) => {
    const credential = pickLiveCredential(
      db
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.cardId, card.id),
            inArray(credentials.state, ["offered", "active"]),
          ),
        )
        .orderBy(desc(credentials.createdAt))
        .all(),
    );

    // The where(inArray(..., ["offered", "active"])) clause above guarantees
    // credential.state is never "failed" here, but Drizzle's inferred column
    // type is still the full union — TS cannot see through a SQL predicate.
    const credentialState: CardCredentialState = credential
      ? (credential.state as "offered" | "active")
      : "none";

    return {
      id: card.id,
      accountId: card.accountId,
      panLast4: card.panLast4,
      network: card.network,
      cardAlias: card.cardAlias,
      credentialState,
      credentialRowId: credential?.id ?? null,
    } satisfies CardDto;
  });
}

/**
 * The user's age-verification credential, if any. One per user: there is no
 * per-card scoping because there is no card behind it.
 *
 * Same rule as `listCards`, through the same helper: a live credential
 * outranks an open offer, the newest wins within a state, and a failed attempt
 * is not a credential.
 */
export function getAgeCredentialState(
  db: Db,
  userId: string,
): AgeCredentialDto {
  const credential = pickLiveCredential(
    db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.userId, userId),
          eq(credentials.credentialTypeId, AV_CREDENTIAL_TYPE_ID),
          inArray(credentials.state, ["offered", "active"]),
        ),
      )
      .orderBy(desc(credentials.createdAt))
      .all(),
  );

  // The inArray predicate above guarantees the state is never "failed", but
  // Drizzle's inferred column type is still the full union — TS cannot see
  // through a SQL predicate. Same cast, same reason, as in listCards.
  return {
    state: credential ? (credential.state as "offered" | "active") : "none",
    credentialRowId: credential?.id ?? null,
  };
}

export function listTransactions(
  db: Db,
  userId: string,
  limit: number,
  offset: number,
): TransactionDto[] {
  const owned = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .all()
    .map((row) => row.id);

  if (owned.length === 0) return [];

  return db
    .select()
    .from(transactions)
    .where(inArray(transactions.accountId, owned))
    .orderBy(desc(transactions.bookedAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map((row) => ({
      id: row.id,
      amountCents: row.amountCents,
      currency: row.currency,
      counterparty: row.counterparty,
      reference: row.reference,
      bookedAt: row.bookedAt,
      paidWithWallet: row.credentialId !== null,
    }));
}
