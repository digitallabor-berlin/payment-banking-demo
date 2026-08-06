import { sql } from "drizzle-orm";
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
  packLabel: string;
  baseQuantity: number;
  baseUnit: "kg" | "l" | "pc";
}

/**
 * A neighbourhood grocer's shelf. Ordered by aisle, because the storefront
 * renders it that way and a stable order keeps the demo reproducible.
 *
 * Photography lives in `public/products/`, centre-cropped to 900×900 so the
 * grid reads as an even shelf rather than a ransom note of aspect ratios.
 */
const FIXTURES: Fixture[] = [
  {
    id: "tomatoes",
    name: "Vine Tomatoes",
    description: "Sweet vine-ripened tomatoes grown in regional greenhouses.",
    priceCents: 199,
    imageUrl: "/products/tomatoes.jpg",
    category: "Produce",
    packLabel: "500 g",
    baseQuantity: 0.5,
    baseUnit: "kg",
  },
  {
    id: "avocado",
    name: "Ripe Avocados",
    description: "Buttery Hass avocados, ripe and ready to eat today.",
    priceCents: 229,
    imageUrl: "/products/avocado.jpg",
    category: "Produce",
    packLabel: "2 pieces",
    baseQuantity: 2,
    baseUnit: "pc",
  },
  {
    id: "berries",
    name: "Mixed Berries",
    description: "Strawberries, blueberries and raspberries, picked this week.",
    priceCents: 349,
    imageUrl: "/products/berries.jpg",
    category: "Produce",
    packLabel: "300 g",
    baseQuantity: 0.3,
    baseUnit: "kg",
  },
  {
    id: "sourdough",
    name: "Sourdough Loaf",
    description: "Long-fermented and baked this morning at the bakery on Kastanienallee.",
    priceCents: 399,
    imageUrl: "/products/sourdough.jpg",
    category: "Bakery",
    packLabel: "750 g",
    baseQuantity: 0.75,
    baseUnit: "kg",
  },
  {
    id: "milk",
    name: "Whole Milk",
    description: "Fresh whole milk from grass-fed cows, lightly pasteurised.",
    priceCents: 139,
    imageUrl: "/products/milch.jpg",
    category: "Dairy",
    packLabel: "1 l",
    baseQuantity: 1,
    baseUnit: "l",
  },
  {
    id: "yogurt",
    name: "Greek Yogurt",
    description: "Thick, strained, and unsweetened.",
    priceCents: 279,
    imageUrl: "/products/yogurt.jpg",
    category: "Dairy",
    packLabel: "500 g",
    baseQuantity: 0.5,
    baseUnit: "kg",
  },
  {
    id: "cheese",
    name: "Aged Gouda",
    description: "Twelve months old, nutty, with the crystals to prove it.",
    priceCents: 449,
    imageUrl: "/products/cheese.jpg",
    category: "Dairy",
    packLabel: "200 g",
    baseQuantity: 0.2,
    baseUnit: "kg",
  },
  {
    id: "pasta",
    name: "Bronze-Cut Pasta",
    description: "Slow-dried, with a rough surface that holds sauce.",
    priceCents: 189,
    imageUrl: "/products/pasta.jpg",
    category: "Pantry",
    packLabel: "500 g",
    baseQuantity: 0.5,
    baseUnit: "kg",
  },
  {
    id: "olive-oil",
    name: "Extra Virgin Olive Oil",
    description: "Cold-pressed from a single estate in Andalusia.",
    priceCents: 799,
    imageUrl: "/products/olive-oil.jpg",
    category: "Pantry",
    packLabel: "500 ml",
    baseQuantity: 0.5,
    baseUnit: "l",
  },
  {
    id: "chocolate",
    name: "Dark Chocolate",
    description: "70% single-origin, ethically sourced cocoa.",
    priceCents: 299,
    imageUrl: "/products/chocolate.jpg",
    category: "Snacks",
    packLabel: "100 g",
    baseQuantity: 0.1,
    baseUnit: "kg",
  },
  {
    id: "chips",
    name: "Sea Salt Chips",
    description: "Kettle-cooked, with flaky sea salt.",
    priceCents: 249,
    imageUrl: "/products/chips.jpg",
    category: "Snacks",
    packLabel: "150 g",
    baseQuantity: 0.15,
    baseUnit: "kg",
  },
  {
    id: "water",
    name: "Sparkling Water",
    description: "Naturally carbonated mineral water from an Alpine spring.",
    priceCents: 89,
    imageUrl: "/products/wasser.jpg",
    category: "Drinks",
    packLabel: "1 l",
    baseQuantity: 1,
    baseUnit: "l",
  },
  {
    id: "beer",
    name: "Unfiltered Lager",
    description: "Brewed in small batches, cloudy on purpose.",
    priceCents: 179,
    imageUrl: "/products/beer.jpg",
    category: "Drinks",
    packLabel: "500 ml",
    baseQuantity: 0.5,
    baseUnit: "l",
  },
  {
    id: "wine",
    name: "Riesling, Trocken",
    description: "A crisp Mosel Riesling with green apple and citrus.",
    priceCents: 899,
    imageUrl: "/products/wine.jpg",
    category: "Drinks",
    packLabel: "750 ml",
    baseQuantity: 0.75,
    baseUnit: "l",
  },
  {
    id: "aperitif",
    name: "Amber Aperitif",
    description: "Bittersweet, botanical, and built for soda water.",
    priceCents: 1399,
    imageUrl: "/products/aperitif.jpg",
    category: "Drinks",
    packLabel: "700 ml",
    baseQuantity: 0.7,
    baseUnit: "l",
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

/**
 * Seeds only a catalogue that has never been seeded. Called at server boot from
 * `src/instrumentation.ts`: a fresh deployment gets an empty PVC, and without
 * this the shop renders zero products and no checkout is possible. `seed.ts` is
 * a tsx script and is not in the runtime image, so `pnpm seed` has no
 * in-cluster equivalent.
 *
 * Guards on `products` specifically, matching what `seed()` actually deletes —
 * orders and payment_sessions are runtime data and are left alone. Returns
 * whether it seeded, so the caller can log which happened.
 */
export function seedIfEmpty(db: Db): boolean {
  const row = db.select({ n: sql<number>`count(*)` }).from(products).get();
  if ((row?.n ?? 0) > 0) return false;
  seed(db);
  return true;
}

/** CLI entry point: `pnpm seed`. */
function main(): void {
  const db = createDb(env.DATABASE_PATH);
  seed(db);
  console.log(`merchant: seeded ${FIXTURES.length} products`);
}

if (process.argv[1]?.endsWith("seed.ts")) main();