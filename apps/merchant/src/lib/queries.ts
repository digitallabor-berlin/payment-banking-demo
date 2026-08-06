import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { products } from "../db/schema.js";

export interface ProductDto {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  category: string;
}

function toDto(row: typeof products.$inferSelect): ProductDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    category: row.category,
  };
}

export function listProducts(db: Db): ProductDto[] {
  return db.select().from(products).all().map(toDto);
}

export function getProduct(db: Db, id: string): ProductDto | null {
  const row = db.select().from(products).where(eq(products.id, id)).get();
  return row ? toDto(row) : null;
}