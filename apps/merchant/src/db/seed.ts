import { createDb, type Db } from "./index.js";
import { products } from "./schema.js";
import { env } from "../env.js";

interface Fixture {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  imageUrl: string;
  category: string;
}

const FIXTURES: Fixture[] = [
  {
    id: "prod_1",
    name: "Wireless Headphones",
    description: "Over-ear, active noise cancelling, 30h battery.",
    priceCents: 12_999,
    imageUrl: "/products/headphones.svg",
    category: "Electronics",
  },
  {
    id: "prod_2",
    name: "Mechanical Keyboard",
    description: "Hot-swappable switches, aluminium frame.",
    priceCents: 8_999,
    imageUrl: "/products/keyboard.svg",
    category: "Electronics",
  },
  {
    id: "prod_3",
    name: "Ceramic Pour-Over Set",
    description: "Dripper, server, and filters for a slow morning.",
    priceCents: 4_499,
    imageUrl: "/products/pour-over.svg",
    category: "Home",
  },
  {
    id: "prod_4",
    name: "Canvas Tote Bag",
    description: "Heavyweight cotton canvas, leather handles.",
    priceCents: 2_999,
    imageUrl: "/products/tote.svg",
    category: "Accessories",
  },
  {
    id: "prod_5",
    name: "Desk Plant — Monstera",
    description: "Low-maintenance, ships in a ceramic pot.",
    priceCents: 3_499,
    imageUrl: "/products/plant.svg",
    category: "Home",
  },
  {
    id: "prod_6",
    name: "Notebook, Dot Grid",
    description: "A5, 160 pages, fountain-pen-friendly paper.",
    priceCents: 1_799,
    imageUrl: "/products/notebook.svg",
    category: "Accessories",
  },
];

/**
 * Resets the database to the documented fixtures (spec §5.3). Idempotent, and
 * deliberately leaves orders/payment_sessions alone — those are runtime data,
 * not fixtures, and re-seeding mid-demo should not erase an in-progress order.
 */
export function seed(db: Db): void {
  db.delete(products).run();
  for (const fixture of FIXTURES) {
    db.insert(products).values(fixture).run();
  }
}

/** CLI entry point: `pnpm seed`. */
function main(): void {
  const db = createDb(env.DATABASE_PATH);
  seed(db);
  console.log(`merchant: seeded ${FIXTURES.length} products`);
}

if (process.argv[1]?.endsWith("seed.ts")) main();