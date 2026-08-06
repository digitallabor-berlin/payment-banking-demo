"use client";

import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader.js";
import { formatEuroCents } from "@/lib/format.js";
import { useCart } from "@/lib/useCart.js";

export default function CartPage() {
  const { items, setQuantity, remove, totalCents } = useCart();

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="display text-4xl">Your basket</h1>

        {items.length === 0 ? (
          // An empty screen is an invitation to act, not an apology.
          <div className="surface mt-8 p-10 text-center">
            <p className="text-[15px] text-[var(--color-muted-foreground)]">
              Nothing in the basket yet.
            </p>
            <Link href="/" className="btn btn-solid mt-5 px-5 py-2.5">
              Browse the shelves
            </Link>
          </div>
        ) : (
          <>
            <ul className="surface mt-8 px-5">
              {items.map((item) => (
                <li key={item.productId} className="line-row py-4">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      width={112}
                      height={112}
                      className="line-thumb"
                    />
                  ) : (
                    // A cart saved before photos existed still renders cleanly.
                    <span className="line-thumb" aria-hidden="true" />
                  )}

                  <div className="min-w-0">
                    <p className="font-semibold">{item.name}</p>
                    <p className="data mt-0.5 text-[var(--color-muted-foreground)]">
                      {item.packLabel ? `${item.packLabel} · ` : ""}
                      {formatEuroCents(item.priceCents)} each
                    </p>
                    <button
                      type="button"
                      onClick={() => remove(item.productId)}
                      className="btn-quiet mt-1.5 text-xs underline underline-offset-2"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="stepper">
                      <button
                        type="button"
                        onClick={() => setQuantity(item.productId, item.quantity - 1)}
                        aria-label={`One fewer ${item.name}`}
                      >
                        −
                      </button>
                      <span className="stepper-value">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity(item.productId, item.quantity + 1)}
                        aria-label={`One more ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                    <span className="w-20 text-right font-semibold tabular-nums">
                      {formatEuroCents(item.priceCents * item.quantity)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="rule-strong mt-8 flex items-baseline justify-between pb-3">
              <span className="eyebrow">Total</span>
              <span className="display text-3xl">{formatEuroCents(totalCents)}</span>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse">
              <Link href="/checkout" className="btn btn-solid flex-1 py-3.5">
                Check out
              </Link>
              <Link href="/" className="btn btn-outline px-5 py-3.5">
                Keep shopping
              </Link>
            </div>
          </>
        )}
      </main>
    </>
  );
}