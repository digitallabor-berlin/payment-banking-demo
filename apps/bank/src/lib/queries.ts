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

export function listCards(db: Db, userId: string): CardDto[] {
  const rows = db.select().from(cards).where(eq(cards.userId, userId)).all();

  return rows.map((card) => {
    // Newest non-failed credential wins: a re-issue supersedes its predecessor.
    const credential = db
      .select()
      .from(credentials)
      .where(
        and(
          eq(credentials.cardId, card.id),
          inArray(credentials.state, ["offered", "active"]),
        ),
      )
      .orderBy(desc(credentials.createdAt))
      .limit(1)
      .get();

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
 * Same rule as `listCards` — newest non-failed row wins, because a re-issue
 * supersedes its predecessor and a failed attempt is not a credential.
 */
export function getAgeCredentialState(db: Db, userId: string): AgeCredentialDto {
  const credential = db
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
    .limit(1)
    .get();

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