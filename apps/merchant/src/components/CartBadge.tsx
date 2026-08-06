"use client";

import Link from "next/link";
import { useCart } from "@/lib/useCart.js";

export function CartBadge() {
  const { itemCount } = useCart();

  return (
    <Link
      href="/cart"
      className="btn btn-outline px-3.5 py-2"
      aria-label={
        itemCount === 0 ? "Cart, empty" : `Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`
      }
    >
      Cart
      {itemCount > 0 ? <span className="count-pill">{itemCount}</span> : null}
    </Link>
  );
}