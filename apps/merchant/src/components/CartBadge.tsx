"use client";

import Link from "next/link";
import { useCart } from "@/lib/useCart.js";

export function CartBadge() {
  const { itemCount } = useCart();

  return (
    <Link
      href="/cart"
      className="relative rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-1.5 text-sm font-medium"
    >
      Cart
      {itemCount > 0 ? (
        <span className="ml-1.5 rounded-full bg-[var(--color-accent)] px-1.5 py-0.5 text-xs font-bold text-white">
          {itemCount}
        </span>
      ) : null}
    </Link>
  );
}