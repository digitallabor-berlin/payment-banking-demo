import type { ProductDto } from "@/lib/queries.js";
import { formatEuroCents } from "@/lib/format.js";

const CATEGORY_COLOR: Record<string, string> = {
  Electronics: "var(--color-brand)",
  Home: "var(--color-accent)",
  Accessories: "var(--color-brand-dark)",
};

export function ProductCard({ product }: { product: ProductDto }) {
  const color = CATEGORY_COLOR[product.category] ?? "var(--color-brand)";

  return (
    <div className="product-card overflow-hidden">
      <div className="product-monogram" style={{ background: color }}>
        {product.name.slice(0, 2).toUpperCase()}
      </div>
      <div className="space-y-2 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {product.category}
        </p>
        <h3 className="font-semibold">{product.name}</h3>
        <p className="text-sm text-[var(--color-muted-foreground)]">{product.description}</p>
        <div className="flex items-center justify-between pt-2">
          <span className="text-lg font-bold">{formatEuroCents(product.priceCents)}</span>
          <button
            type="button"
            disabled
            title="Cart is wired up in the next task"
            className="rounded-[var(--radius)] bg-[var(--color-brand)] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}