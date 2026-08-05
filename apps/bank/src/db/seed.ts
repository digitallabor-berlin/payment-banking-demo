import { hashPassword } from "../lib/password.js";
import { createDb, type Db } from "./index.js";
import { accounts, cards, credentials, transactions, users } from "./schema.js";
import { env } from "../env.js";

const DAY_MS = 86_400_000;

interface Fixture {
  userId: string;
  username: string;
  displayName: string;
  accountId: string;
  iban: string;
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
    balanceCents: 348_712,
    cardId: "card_anna",
    panLast4: "4242",
    network: "VISA",
    cardAlias: "Girocard",
  },
  {
    userId: "user_ben",
    username: "ben",
    displayName: "Ben Müller",
    accountId: "acc_ben",
    iban: "DE02500105170137075030",
    balanceCents: 129_540,
    cardId: "card_ben",
    panLast4: "8815",
    network: "Mastercard",
    cardAlias: "Kreditkarte",
  },
];

/** Ten plausible booked transactions, newest first. */
const HISTORY: Array<{ counterparty: string; reference: string; amountCents: number }> = [
  { counterparty: "REWE Markt GmbH", reference: "Kartenzahlung", amountCents: -4_215 },
  { counterparty: "Deutsche Bahn AG", reference: "Fahrkarte Berlin-Hamburg", amountCents: -8_990 },
  { counterparty: "Stadtwerke Musterstadt", reference: "Abschlag Strom", amountCents: -7_400 },
  { counterparty: "Arbeitgeber GmbH", reference: "Gehalt", amountCents: 245_000 },
  { counterparty: "Netflix International", reference: "Abo", amountCents: -1_799 },
  { counterparty: "Apotheke am Markt", reference: "Kartenzahlung", amountCents: -2_340 },
  { counterparty: "Vermietung Mustermann", reference: "Miete", amountCents: -98_000 },
  { counterparty: "dm-drogerie markt", reference: "Kartenzahlung", amountCents: -3_112 },
  { counterparty: "Telekom Deutschland", reference: "Mobilfunk", amountCents: -3_999 },
  { counterparty: "Buchhandlung Lesezeit", reference: "Kartenzahlung", amountCents: -2_650 },
];

/**
 * Resets the database to the documented fixtures (spec 5.3). Idempotent:
 * deletes every row first, so `pnpm seed` returns the demo to a known state.
 */
export function seed(db: Db, now = Date.now()): void {
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
      })
      .run();

    db.insert(accounts)
      .values({
        id: fixture.accountId,
        userId: fixture.userId,
        iban: fixture.iban,
        currency: "EUR",
        balanceCents: fixture.balanceCents,
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