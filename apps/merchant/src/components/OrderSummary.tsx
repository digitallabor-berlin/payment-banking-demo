import { formatEuroCents } from "@/lib/format.js";
import type { OrderLine } from "@/lib/order-lines.js";
import { AgeChip } from "./AgeChip.js";

/**
 * What is being paid for, on the standalone /pay route.
 *
 * Deliberately in the same visual language as the checkout basket aside: a
 * shopper who lands here from a deep link should see the same summary a shopper
 * who came through /checkout still has behind the sheet. This is honest content
 * derived from `order_items`, not decoration placed to give the scrim something
 * to dim.
 */
export function OrderSummary({
  lines,
  totalCents,
  customerName,
}: {
  lines: OrderLine[];
  totalCents: number;
  customerName: string;
}) {
  return (
    <div className="surface p-5">
      <h2 className="eyebrow">Your order</h2>
      <p className="mt-1 text-[15px] font-semibold">{customerName}</p>

      <ul className="mt-4 space-y-2.5">
        {lines.map((line) => (
          <li
            key={line.productId}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <span className="min-w-0">
              <span className="data mr-1.5 text-[var(--color-muted-foreground)]">
                {line.quantity}×
              </span>
              {line.name}
              {line.ageRestricted ? <AgeChip className="ml-1.5" /> : null}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatEuroCents(line.lineTotalCents)}
            </span>
          </li>
        ))}
      </ul>

      <div className="rule-strong mt-4 pb-2.5" />
      <div className="flex items-baseline justify-between">
        <span className="eyebrow">Total</span>
        <span className="display text-2xl">{formatEuroCents(totalCents)}</span>
      </div>
    </div>
  );
}