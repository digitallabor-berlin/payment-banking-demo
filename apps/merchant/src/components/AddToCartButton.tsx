"use client";

import type { ProductDto } from "@/lib/queries.js";
import { useCart } from "@/lib/useCart.js";

export function AddToCartButton({ product }: { product: ProductDto }) {
  const { add } = useCart();

  return (
    <button
      type="button"
      onClick={() =>
        add({ productId: product.id, name: product.name, priceCents: product.priceCents })
      }
      className="rounded-[var(--radius)] bg-[var(--color-brand)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-brand-dark)]"
    >
      Add to Cart
    </button>
  );
}