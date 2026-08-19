import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { products } from "../db/schema.js";
import { isAgeRestricted } from "./dcql.js";

export interface ProductDto {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  category: string;
  /** Shelf photography, served from `public/products/`. */
  imageUrl: string;
  /** Pack size as printed, e.g. "300 g". */
  packLabel: string;
  baseQuantity: number;
  baseUnit: "kg" | "l" | "pc";
  /**
   * Derived, never stored. The restricted set lives in `lib/dcql.ts` beside the
   * named-query escalation it drives; a column here would imply an editing
   * surface that does not exist.
   */
  ageRestricted: boolean;
}

function toDto(row: typeof products.$inferSelect): ProductDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    category: row.category,
    imageUrl: row.imageUrl,
    packLabel: row.packLabel,
    baseQuantity: row.baseQuantity,
    baseUnit: row.baseUnit,
    ageRestricted: isAgeRestricted(row.id),
  };
}

export function listProducts(db: Db): ProductDto[] {
  return db.select().from(products).all().map(toDto);
}

export function getProduct(db: Db, id: string): ProductDto | null {
  const row = db.select().from(products).where(eq(products.id, id)).get();
  return row ? toDto(row) : null;
}

export interface Aisle {
  name: string;
  products: ProductDto[];
}

/**
 * Groups the catalogue into aisles in first-appearance order. A shop is laid
 * out in aisles, so the storefront is too — and the seed's order is the
 * merchandiser's decision, which an alphabetical sort here would overrule.
 */
export function listAisles(db: Db): Aisle[] {
  const aisles: Aisle[] = [];

  for (const product of listProducts(db)) {
    const existing = aisles.find((aisle) => aisle.name === product.category);
    if (existing) existing.products.push(product);
    else aisles.push({ name: product.category, products: [product] });
  }

  return aisles;
}