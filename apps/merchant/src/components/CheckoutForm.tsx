"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { formatEuroCents } from "@/lib/format.js";
import { useCart } from "@/lib/useCart.js";

export function CheckoutForm() {
  const router = useRouter();
  const { items, totalCents, clear } = useCart();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
        setError("Could not create the order. Please check your cart and try again.");
        return;
      }
      const order = (await orderResponse.json()) as { orderId: string };

      const sessionResponse = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId }),
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
    return <p className="text-[var(--color-muted-foreground)]">Your cart is empty.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Full name
        </label>
        <input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full rounded-[var(--radius)] border border-[var(--color-border)] px-3 py-2"
        />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="checkout-cta w-full rounded-[var(--radius)] py-3 font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Starting payment…" : `Pay with EUDI Wallet — ${formatEuroCents(totalCents)}`}
      </button>
    </form>
  );
}