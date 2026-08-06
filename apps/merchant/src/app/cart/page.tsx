"use client";

import Link from "next/link";
import { formatEuroCents } from "@/lib/format.js";
import { useCart } from "@/lib/useCart.js";

export default function CartPage() {
  const { items, setQuantity, remove, totalCents } = useCart();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-bold">Your Cart</h1>

      {items.length === 0 ? (
        <p className="text-[var(--color-muted-foreground)]">
          Your cart is empty.{" "}
          <Link href="/" className="font-medium text-[var(--color-brand)]">
            Continue shopping
          </Link>
          .
        </p>
      ) : (
        <>
          <ul>
            {items.map((item) => (
              <li key={item.productId} className="cart-row">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.name}</p>
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {formatEuroCents(item.priceCents)} each
                  </p>
                </div>
                <div className="quantity-stepper">
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity - 1)}
                    aria-label={`Decrease quantity of ${item.name}`}
                  >
                    −
                  </button>
                  <span className="tabular-nums">{item.quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(item.productId, item.quantity + 1)}
                    aria-label={`Increase quantity of ${item.name}`}
                  >
                    +
                  </button>
                </div>
                <span className="w-20 text-right font-semibold tabular-nums">
                  {formatEuroCents(item.priceCents * item.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(item.productId)}
                  aria-label={`Remove ${item.name}`}
                  className="text-sm text-[var(--color-destructive)]"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between">
            <span className="text-lg font-semibold">Total</span>
            <span className="text-lg font-bold">{formatEuroCents(totalCents)}</span>
          </div>

          <Link
            href="/checkout"
            className="mt-6 block w-full rounded-[var(--radius)] bg-[var(--color-brand)] py-3 text-center font-semibold text-white hover:bg-[var(--color-brand-dark)]"
          >
            Proceed to Checkout
          </Link>
        </>
      )}
    </main>
  );
}