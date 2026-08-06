"use client";

import type { ProductDto } from "@/lib/queries.js";
import { useCart } from "@/lib/useCart.js";

export function AddToCartButton({ product }: { product: ProductDto }) {
  const { add } = useCart();

  return (
    <button
      type="button"
      onClick={() =>
        add({
          productId: product.id,
          name: product.name,
          priceCents: product.priceCents,
          imageUrl: product.imageUrl,
          packLabel: product.packLabel,
        })
      }
      className="btn btn-solid px-3.5 py-2"
      aria-label={`Add ${product.name} to cart`}
    >
      Add
    </button>
  );
}