import { sql } from "drizzle-orm";
import { hashPassword } from "../lib/password.js";
import { createDb, type Db } from "./index.js";
import {
  accounts,
  cards,
  credentials,
  limitChangeSessions,
  loginSessions,
  transactionProofs,
  transactions,
  transferSessions,
  users,
} from "./schema.js";
import { env } from "../env.js";

const DAY_MS = 86_400_000;

interface Fixture {
  userId: string;
  username: string;
  displayName: string;
  accountId: string;
  /**
   * MUST end in four digits. `lib/display-metadata.ts` derives the DPC
   * `card.last_four` from it and foundry enforces `^[0-9]{4}$`, rejecting the
   * entire issuance offer otherwise. `seed.test.ts` asserts this against the
   * seeded rows — `seed` is the only writer of `accounts`, so that check covers
   * the whole database.
   */
  iban: string;
  /**
   * The two fixtures MUST differ here. A test proving the right customer's row
   * was written could otherwise pass by coincidence, and `seed.test.ts` asserts
   * the distinctness rather than trusting these literals.
   */
  phoneNumber: string;
  balanceCents: number;
  cardId: string;
  panLast4: string;
  network: string;
  cardAlias: string;
}

const FIXTURES: Fixture[] = [
  {
    userId: "user_anna",
    username: "anna",
    displayName: "Anna Schmidt",
    accountId: "acc_anna",
    iban: "DE02120300000000202051",
    phoneNumber: "+49 171 5555555",
    balanceCents: 348_712,
    cardId: "card_anna",
    panLast4: "4242",
    network: "girocard",
    cardAlias: "Girocard",
  },
  {
    userId: "user_ben",
    username: "ben",
    displayName: "Ben Müller",
    accountId: "acc_ben",
    iban: "DE02500105170137075030",
    phoneNumber: "+49 160 2345678",
    balanceCents: 129_540,
    cardId: "card_ben",
    panLast4: "8815",
    // girocard for both cards: it is the only network the DPC display metadata
    // has branding assets for, and the merchant's fixtures already assume it.
    network: "girocard",
    cardAlias: "Kreditkarte",
  },
];

/** Ten plausible booked transactions, newest first. */
const HISTORY: Array<{
  counterparty: string;
  reference: string;
  amountCents: number;
}> = [
  {
    counterparty: "REWE Markt GmbH",
    reference: "Kartenzahlung",
    amountCents: -4_215,
  },
  {
    counterparty: "Deutsche Bahn AG",
    reference: "Fahrkarte Berlin-Hamburg",
    amountCents: -8_990,
  },
  {
    counterparty: "Stadtwerke Musterstadt",
    reference: "Abschlag Strom",
    amountCents: -7_400,
  },
  {
    counterparty: "Arbeitgeber GmbH",
    reference: "Gehalt",
    amountCents: 245_000,
  },
  {
    counterparty: "Netflix International",
    reference: "Abo",
    amountCents: -1_799,
  },
  {
    counterparty: "Apotheke am Markt",
    reference: "Kartenzahlung",
    amountCents: -2_340,
  },
  {
    counterparty: "Vermietung Mustermann",
    reference: "Miete",
    amountCents: -98_000,
  },
  {
    counterparty: "dm-drogerie markt",
    reference: "Kartenzahlung",
    amountCents: -3_112,
  },
  {
    counterparty: "Telekom Deutschland",
    reference: "Mobilfunk",
    amountCents: -3_999,
  },
  {
    counterparty: "Buchhandlung Lesezeit",
    reference: "Kartenzahlung",
    amountCents: -2_650,
  },
];

/**
 * Resets the database to the documented fixtures (spec 5.3). Idempotent:
 * deletes every row first, so `pnpm seed` returns the demo to a known state.
 *
 * ATOMIC, and that is not decoration. `createDb` sets `foreign_keys = ON`, so
 * a table referencing `users` or `accounts` that is not cleared first makes the
 * delete sequence THROW partway through — and without a transaction it throws
 * having already destroyed every transaction, credential and card. A command
 * documented as "reset the demo" would leave a dashboard with accounts and
 * nothing else, and fail identically on every later attempt.
 *
 * That was not hypothetical: `limit_change_sessions` has NOT NULL FKs to both,
 * and one abandoned limit-change attempt was enough to trigger it. Locally that
 * is every attempt, because no local foundry declares `sparkassen_auth`.
 *
 * **A new table with an FK to `users` or `accounts` must be deleted here**, in
 * an order that respects its references, or `pnpm seed` breaks the first time
 * anything writes to it.
 */
export function seed(db: Db, now = Date.now()): void {
  db.transaction(() => {
    seedWithin(db, now);
  });
}

/** The body of `seed`, factored out only so the transaction wrapper is legible. */
function seedWithin(db: Db, now: number): void {
  // Children before parents. `transfer_sessions` references `users`,
  // `accounts` AND `transactions`, so it goes first of all;
  // `limit_change_sessions` references both `users` and `accounts`;
  // `transaction_proofs` references `transactions`.
  db.delete(transferSessions).run();
  db.delete(limitChangeSessions).run();
  db.delete(transactionProofs).run();
  db.delete(loginSessions).run();
  db.delete(transactions).run();
  db.delete(credentials).run();
  db.delete(cards).run();
  db.delete(accounts).run();
  db.delete(users).run();

  const passwordHash = hashPassword("demo1234");

  for (const fixture of FIXTURES) {
    db.insert(users)
      .values({
        id: fixture.userId,
        username: fixture.username,
        passwordHash,
        displayName: fixture.displayName,
        // Stated explicitly rather than left to the column DEFAULT, so the
        // demo's starting numbers are visible in the fixtures rather than only
        // in the schema — and so the two customers differ.
        phoneNumber: fixture.phoneNumber,
      })
      .run();

    db.insert(accounts)
      .values({
        id: fixture.accountId,
        userId: fixture.userId,
        iban: fixture.iban,
        currency: "EUR",
        balanceCents: fixture.balanceCents,
        // Stated explicitly rather than left to the column DEFAULT, so the
        // demo's starting number is visible in the fixtures rather than only
        // in the schema. 1.000,00 € — the preset the dialog then refuses to
        // offer, because it is the one already in force.
        dailyLimitCents: 100_000,
      })
      .run();

    db.insert(cards)
      .values({
        id: fixture.cardId,
        userId: fixture.userId,
        accountId: fixture.accountId,
        panLast4: fixture.panLast4,
        network: fixture.network,
        cardAlias: fixture.cardAlias,
        createdAt: now - 400 * DAY_MS,
      })
      .run();

    HISTORY.forEach((entry, index) => {
      db.insert(transactions)
        .values({
          id: `tx_${fixture.userId}_${index}`,
          accountId: fixture.accountId,
          amountCents: entry.amountCents,
          currency: "EUR",
          counterparty: entry.counterparty,
          reference: entry.reference,
          bookedAt: now - (index + 1) * 2 * DAY_MS,
          credentialId: null,
          idempotencyKey: null,
        })
        .run();
    });
  }
}

/**
 * Seeds only a database that has never been seeded. Called at server boot from
 * `src/instrumentation.ts` so a fresh deployment (empty PVC) is immediately
 * demoable without an operator step — `seed.ts` is a tsx script and is not in
 * the runtime image, so `pnpm seed` has no in-cluster equivalent.
 *
 * The emptiness check is the entire safety property: `seed()` deletes every row
 * before inserting, so calling it on a populated database would destroy live
 * demo state. Returns whether it seeded, so the caller can log which happened.
 */
export function seedIfEmpty(db: Db, now = Date.now()): boolean {
  const row = db.select({ n: sql<number>`count(*)` }).from(users).get();
  if ((row?.n ?? 0) > 0) return false;
  seed(db, now);
  return true;
}

/** CLI entry point: `pnpm seed`. */
function main(): void {
  const db = createDb(env.DATABASE_PATH);
  seed(db);
  console.log(
    `bank: seeded ${FIXTURES.length} users — login with ` +
      FIXTURES.map((f) => `${f.username}/demo1234`).join(" or "),
  );
}

if (process.argv[1]?.endsWith("seed.ts")) main();
