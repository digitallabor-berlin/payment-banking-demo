"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { DC_API_PRESENTATION_PROTOCOL, useDcApiSupport } from "@demo/ui";
import { cartHasAgeRestricted } from "@/lib/cart.js";
import { isAgeRestricted } from "@/lib/dcql.js";
import { formatEuroCents } from "@/lib/format.js";
import { selectTransport } from "@/lib/transport.js";
import { AgeChip } from "./AgeChip.js";
import { useCart } from "@/lib/useCart.js";

export function CheckoutForm() {
  const router = useRouter();
  const { items, totalCents, clear } = useCart();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Detection must happen HERE, not on the pay page: `transport` changes the
  // OpenID4VP wire and is therefore fixed when the session is created.
  const dcApiSupported = useDcApiSupport("get", DC_API_PRESENTATION_PROTOCOL);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const orderResponse = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
          customer: { name, email },
        }),
      });
      if (!orderResponse.ok) {
        setError("Could not create the order. Please check your basket and try again.");
        return;
      }
      const order = (await orderResponse.json()) as { orderId: string };

      const sessionResponse = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          dcApi: selectTransport(dcApiSupported) === "dc_api",
        }),
      });
      if (!sessionResponse.ok) {
        setError("Could not start the payment. Please try again.");
        return;
      }
      const session = (await sessionResponse.json()) as { sessionId: string };

      clear();
      router.push(`/pay/${session.sessionId}`);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="surface p-10 text-center">
        <p className="text-[15px] text-[var(--color-muted-foreground)]">
          There is nothing to pay for yet.
        </p>
        <Link href="/" className="btn btn-solid mt-5 px-5 py-2.5">
          Browse the shelves
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 md:grid-cols-[1fr_18rem] md:items-start">
      <form onSubmit={onSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="name" className="eyebrow block">
            Full name
          </label>
          <input
            id="name"
            name="name"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="field px-3.5 py-2.5"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="email" className="eyebrow block">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            className="field px-3.5 py-2.5"
          />
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Your receipt goes here. Nothing else.
          </p>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-[var(--color-destructive)]">
            {error}
          </p>
        ) : null}

        {cartHasAgeRestricted(items) ? (
          <div className="age-note px-3.5 py-3">
            <AgeChip />
            <span>
              Your wallet will confirm you&rsquo;re over 18. It won&rsquo;t share your
              date of birth.
            </span>
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="checkout-cta btn w-full py-3.5 text-[0.9375rem]"
        >
          {pending
            ? "Starting payment…"
            : `Pay ${formatEuroCents(totalCents)} with your EUDI Wallet`}
        </button>
      </form>

      {/* The basket stays visible: nobody should have to trust a total they
          cannot see while typing their name. */}
      <aside className="surface p-5">
        <h2 className="eyebrow">Your basket</h2>
        <ul className="mt-3 space-y-2.5">
          {items.map((item) => (
            <li key={item.productId} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="data mr-1.5 text-[var(--color-muted-foreground)]">
                  {item.quantity}×
                </span>
                {item.name}
                {isAgeRestricted(item.productId) ? <AgeChip className="ml-1.5" /> : null}
              </span>
              <span className="shrink-0 tabular-nums">
                {formatEuroCents(item.priceCents * item.quantity)}
              </span>
            </li>
          ))}
        </ul>
        <div className="rule-strong mt-4 pb-2.5" />
        <div className="flex items-baseline justify-between">
          <span className="eyebrow">Total</span>
          <span className="display text-2xl">{formatEuroCents(totalCents)}</span>
        </div>
      </aside>
    </div>
  );
}