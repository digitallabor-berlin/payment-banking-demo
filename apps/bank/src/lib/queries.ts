import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/index.js";
import {
 accounts,
 cards,
 credentials,
 transactionProofs,
 transactions,
} from "../db/schema.js";
import {
 AGE_CREDENTIAL_TYPE_IDS,
 CARD_FORMAT_TYPE_IDS,
 SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
 WERO_CREDENTIAL_TYPE_ID,
 type AgeCredentialTypeId,
 type CardFormatTypeId,
} from "./credential-types.js";

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
 /**
  * The card's state across ALL its formats — what the card face draws. The
  * EU's stars belong on the artwork once the card is in a wallet at all; which
  * format got it there is not something the face has an opinion about.
  */
 credentialState: CardCredentialState;
 credentialRowId: string | null;
 /**
  * The same question asked per format, which is what each of the tile's two
  * wallet buttons needs.
  *
  * Without this the buttons would lie to each other: adding the card through
  * one of them would flip the other's label to "add again" for a credential
  * that was never issued in that format.
  *
  * Keyed by `CardFormatTypeId`, not by every payment type: Wero is payable but
  * it is a separate instrument with its own tile, and a key for it here would
  * grow the card tile a button for something that is not this card.
  */
 formats: Record<CardFormatTypeId, CardCredentialState>;
}

/**
 * The user's Wero credential, if any.
 *
 * Deliberately carries no `formats` map, unlike the card and the age
 * credential. Those have one because two buttons can lie to each other about
 * what the other issued; Wero is offered for the EUDI Wallet alone, so there is
 * exactly one format and nothing for a second button to disagree with.
 */
export interface WeroCredentialDto {
 state: CardCredentialState;
 credentialRowId: string | null;
}

/**
 * The user's Sparkassen Authenticator credential, if any.
 *
 * Structurally identical to `WeroCredentialDto` and for the same reason — one
 * format, one button, nothing for a second button to disagree with — but a
 * separate interface rather than a shared one. They describe different
 * credentials, and merging them would invite a single query serving both.
 */
export interface AuthenticatorCredentialDto {
 state: CardCredentialState;
 credentialRowId: string | null;
}

export interface AgeCredentialDto {
 /**
  * The credential's state across BOTH its formats — what the tile's badge and
  * face draw. It is in a wallet or it is not; which wallet received it is not
  * something the face has an opinion about.
  */
 state: CardCredentialState;
 credentialRowId: string | null;
 /**
  * The same question asked per format, which is what each of the tile's two
  * wallet buttons needs. Exactly `CardDto.formats`' reason for existing:
  * without it, adding the credential through one button flips the other's
  * label to "add again" for a format that was never issued.
  */
 formats: Record<AgeCredentialTypeId, CardCredentialState>;
}

export interface TransactionDto {
 id: string;
 amountCents: number;
 currency: string;
 counterparty: string;
 reference: string;
 bookedAt: number;
 paidWithWallet: boolean;
 /**
  * Whether a PaSO proof package was stored with this transaction.
  *
  * A boolean rather than the package itself: a `vp_token` is kilobytes and
  * this DTO is rendered twenty at a time. The viewer fetches the package by id
  * when it opens.
  */
 hasProof: boolean;
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

/**
 * The state of a chosen subset of a card's non-failed credential rows.
 *
 * `pickLiveCredential` is applied at two scopes here — once across every
 * format, once within each — rather than the combined answer being derived
 * from the per-format ones. "Active outranks offered, newest wins within a
 * state" is one rule, and asking it twice of the same rows is cheaper than a
 * second rule for combining its own answers.
 */
function stateOf(rows: Array<{ id: string; state: string }>): {
 state: CardCredentialState;
 rowId: string | null;
} {
 const credential = pickLiveCredential(rows);
 // The caller's where(inArray(..., ["offered", "active"])) guarantees the
 // state is never "failed" here, but Drizzle's inferred column type is still
 // the full union — TS cannot see through a SQL predicate.
 return {
  state: credential ? (credential.state as "offered" | "active") : "none",
  rowId: credential?.id ?? null,
 };
}

export function listCards(db: Db, userId: string): CardDto[] {
 const rows = db.select().from(cards).where(eq(cards.userId, userId)).all();

 return rows.map((card) => {
  // Scoped to the GIROCARD's formats, not to every payment type. That
  // distinction is load-bearing since Wero: a Wero row is payable, so it
  // carries a card_id and this card-scoped query would sweep it in, and the
  // girocard's face would then read "In wallet" for a credential that is not
  // a girocard at all. (An age credential could never be swept in — it has no
  // card — so for that one the filter is merely an assertion.)
  const live = db
   .select()
   .from(credentials)
   .where(
    and(
     eq(credentials.cardId, card.id),
     inArray(credentials.credentialTypeId, [...CARD_FORMAT_TYPE_IDS]),
     inArray(credentials.state, ["offered", "active"]),
    ),
   )
   .orderBy(desc(credentials.createdAt))
   .all();

  const combined = stateOf(live);
  const formats = Object.fromEntries(
   CARD_FORMAT_TYPE_IDS.map((typeId) => [
    typeId,
    stateOf(live.filter((row) => row.credentialTypeId === typeId)).state,
   ]),
  ) as Record<CardFormatTypeId, CardCredentialState>;

  return {
   id: card.id,
   accountId: card.accountId,
   panLast4: card.panLast4,
   network: card.network,
   cardAlias: card.cardAlias,
   credentialState: combined.state,
   credentialRowId: combined.rowId,
   formats,
  } satisfies CardDto;
 });
}

/**
 * The user's age-verification credential, if any. One per user: there is no
 * per-card scoping because there is no card behind it.
 *
 * Same rule as `listCards`, through the same two helpers, at the same two
 * scopes: a live credential outranks an open offer, the newest wins within a
 * state, a failed attempt is not a credential, and the combined answer is that
 * rule asked of every format's rows rather than derived from the per-format
 * answers.
 *
 * Both age formats are matched, so a bare `av` row — which this function
 * deliberately ignored while `av` was merely a legacy spelling — now resolves
 * as the Google Wallet format.
 */
export function getAgeCredentialState(
 db: Db,
 userId: string,
): AgeCredentialDto {
 const live = db
  .select()
  .from(credentials)
  .where(
   and(
    eq(credentials.userId, userId),
    inArray(credentials.credentialTypeId, [...AGE_CREDENTIAL_TYPE_IDS]),
    inArray(credentials.state, ["offered", "active"]),
   ),
  )
  .orderBy(desc(credentials.createdAt))
  .all();

 const combined = stateOf(live);
 const formats = Object.fromEntries(
  AGE_CREDENTIAL_TYPE_IDS.map((typeId) => [
   typeId,
   stateOf(live.filter((row) => row.credentialTypeId === typeId)).state,
  ]),
 ) as Record<AgeCredentialTypeId, CardCredentialState>;

 return {
  state: combined.state,
  credentialRowId: combined.rowId,
  formats,
 };
}

/**
 * The user's Wero credential, if any.
 *
 * Scoped by user and type rather than by card. Wero is drawn on the account,
 * not on a card — the row references one only because `processPayment` needs a
 * card to debit — so a user has one Wero credential however many cards they
 * hold.
 *
 * Same rule as `listCards` and `getAgeCredentialState`, through the same two
 * helpers: a live credential outranks an open offer, the newest wins within a
 * state, and a failed attempt is not a credential. Only one scope here, because
 * there is only one format.
 */
export function getWeroCredentialState(
 db: Db,
 userId: string,
): WeroCredentialDto {
 const live = db
  .select()
  .from(credentials)
  .where(
   and(
    eq(credentials.userId, userId),
    eq(credentials.credentialTypeId, WERO_CREDENTIAL_TYPE_ID),
    inArray(credentials.state, ["offered", "active"]),
   ),
  )
  .orderBy(desc(credentials.createdAt))
  .all();

 const { state, rowId } = stateOf(live);
 return { state, credentialRowId: rowId };
}

/**
 * The user's Sparkassen Authenticator credential, if any.
 *
 * Scoped by user and type, like `getWeroCredentialState`, but for a stronger
 * reason: this credential has no card at all, so there is no card to scope by.
 * A user has one authenticator credential however many cards they hold.
 *
 * Same rule as every other tile, through the same two helpers: a live
 * credential outranks an open offer, the newest wins within a state, and a
 * failed attempt is not a credential. One scope only, because there is one
 * format — no Google Wallet handover exists for this credential.
 */
export function getAuthenticatorCredentialState(
 db: Db,
 userId: string,
): AuthenticatorCredentialDto {
 const live = db
  .select()
  .from(credentials)
  .where(
   and(
    eq(credentials.userId, userId),
    eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID),
    inArray(credentials.state, ["offered", "active"]),
   ),
  )
  .orderBy(desc(credentials.createdAt))
  .all();

 const { state, rowId } = stateOf(live);
 return { state, credentialRowId: rowId };
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

 const rows = db
  .select()
  .from(transactions)
  .where(inArray(transactions.accountId, owned))
  .orderBy(desc(transactions.bookedAt))
  .limit(limit)
  .offset(offset)
  .all();

 // One IN query over the page, not a lookup per row. The page is at most a
 // hundred ids and this runs on every dashboard render.
 const withProof = new Set(
  rows.length === 0
   ? []
   : db
      .select({ id: transactionProofs.transactionId })
      .from(transactionProofs)
      .where(
       inArray(
        transactionProofs.transactionId,
        rows.map((row) => row.id),
       ),
      )
      .all()
      .map((row) => row.id),
 );

 return rows.map((row) => ({
  id: row.id,
  amountCents: row.amountCents,
  currency: row.currency,
  counterparty: row.counterparty,
  reference: row.reference,
  bookedAt: row.bookedAt,
  paidWithWallet: row.credentialId !== null,
  hasProof: withProof.has(row.id),
 }));
}

/**
 * The body of `GET /api/transactions/{id}/proof`.
 *
 * `proofPackage` holds the spec's own member names — `signed_request` and
 * `vp_token` — because it IS the PaSO Proof/Verify §4.1 package, and the viewer
 * shows it raw. Everything beside it is ours, and camelCase like every other
 * DTO here. Mixing the two casings in one object is deliberate: the boundary
 * between "the artefact" and "what we recorded about it" should be visible.
 *
 * Declared as a named type and used as `getTransactionProof`'s return
 * ANNOTATION rather than inferred. That annotation is the guard: this repo has
 * shipped a bug where a route's object literal silently omitted a member the
 * client read (`dcApiProtocol`, 6e997da), and only a written-out return type
 * turns that into a compile error.
 */
export interface TransactionProofBody {
 proofPackage: { signed_request: string; vp_token: unknown };
 receivedAt: number;
}

/**
 * The stored proof package for one transaction, scoped to its owner.
 *
 * Ownership is checked here rather than in the route, for the same reason
 * `listTransactions` scopes by account: a transaction id is guessable, and a
 * proof package contains a holder's wallet presentation. A transaction that
 * exists but belongs to someone else is indistinguishable from one that does
 * not exist — both are null.
 */
export function getTransactionProof(
 db: Db,
 userId: string,
 transactionId: string,
): TransactionProofBody | null {
 const owned = db
  .select({ id: accounts.id })
  .from(accounts)
  .where(eq(accounts.userId, userId))
  .all()
  .map((row) => row.id);
 if (owned.length === 0) return null;

 const transaction = db
  .select({ accountId: transactions.accountId })
  .from(transactions)
  .where(eq(transactions.id, transactionId))
  .get();
 if (!transaction || !owned.includes(transaction.accountId)) return null;

 const proof = db
  .select()
  .from(transactionProofs)
  .where(eq(transactionProofs.transactionId, transactionId))
  .get();
 if (!proof) return null;

 // Written by us, so this cannot fail in practice — but it is read back from a
 // database that outlives the process that wrote it, and a throw here would be
 // a 500 on a page that is otherwise fine.
 let vpToken: unknown;
 try {
  vpToken = JSON.parse(proof.vpTokenJson);
 } catch {
  return null;
 }

 return {
  proofPackage: { signed_request: proof.signedRequest, vp_token: vpToken },
  receivedAt: proof.receivedAt,
 };
}
