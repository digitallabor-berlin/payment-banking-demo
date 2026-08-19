# Payment Sheet Redesign and 18+ Marking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mark age-restricted products across the storefront, and rebuild the
EudiPay payment sheet as a modal that opens over a live `/checkout` page instead
of a dimmed empty route.

**Architecture:** Every rendering decision moves out of JSX into pure `.ts`
modules (`sheet-state.ts`, `isAgeRestricted`, `cartHasAgeRestricted`,
`loadCheckoutSession`) so vitest can reach it — all four vitest projects run
`environment: "node"` with `include: ["src/**/*.test.ts"]`, so `.tsx` is never
tested. The sheet becomes a saturated `#003BA8` field whose status indicator is
the EU twelve-star ring migrated out of `EudiPayLogo`, and `CheckoutForm` stops
navigating to `/pay/[sessionId]`: a new `CheckoutPanel` renders the sheet as a
sibling overlay and mirrors the session into `?session=` so a wallet round trip
can re-open it.

**Tech Stack:** Next.js 15 (App Router, `src/app`), React 19, Tailwind v4
(`@theme` in `globals.css`), drizzle-orm + better-sqlite3, vitest 2, `next/font`
(Archivo, Bricolage Grotesque, Instrument Sans, IBM Plex Mono).

**Spec:** `docs/superpowers/specs/2026-08-19-payment-sheet-and-age-marking-design.md`

## Global Constraints

- **`pnpm`, never `npm`.** Run everything from the repo root unless a task says
  otherwise.
- **`pnpm check` is the gate** (`typecheck && test` across all 4 projects).
  Baseline is **253 tests** measured 2026-08-19 (87 bank + 131 merchant + 10
  foundry-client + 25 ui). This plan projects **294**. Projections in this repo
  have been wrong before — a previous plan projected 210 against an actual 218 —
  so **measure and report the real number**, never restate 294.
- **`pnpm dev` is broken.** Anything needing a running server uses `pnpm build`
  then `pnpm --filter @demo/merchant start`. See `AGENTS.md`.
- **Local imports are written `./foo.js` for a `./foo.ts` file.** Correct Node
  ESM form; required for vitest and tsc to agree.
- **TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`.** An
  intentionally-unused parameter must be prefixed `_`.
- **All money is integer cents.** Never a float. Never `Intl` for a value that
  crosses a wire.
- **No hardcoded URLs or secrets.** Everything from zod-validated `env`.
- **TDD.** Write the failing test, run it, confirm it fails for the right
  reason, then implement.
- **Locked brand values** (spec §3.1), used verbatim: `#004DD7`, `#FFCC00`,
  `#FFEFB4`, plus `#003BA8` (already in `EudiPayLogo.tsx`), `#5A4400`,
  `#FFB3B3`.
- **The glyph is exactly `18+`**, never `+18` (spec §7.2).
- **`next/font` variables must not be named after a Tailwind `@theme` token.**
  `layout.tsx` documents why: `@theme` writes `--font-display` to `:root`, the
  same element `next/font` writes to, so a self-referential token resolves to
  nothing. The new font variable is `--font-eudipay-face`; the `@theme` token
  consuming it is `--font-eudipay`.
- **No `await` may execute between a click handler starting and
  `navigator.credentials.get()`.** Chrome consumes the click's transient
  activation. The DC API payload must already be a prop.
- **Commits** use conventional prefixes and state what was *verified*, plainly
  stating what was not.

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `packages/ui/src/euStars.ts` | Pure EU twelve-star geometry: `ringPoints`, `starPath`. |
| `packages/ui/src/euStars.test.ts` | Tests for the above. |
| `apps/merchant/src/lib/sheet-state.ts` | `selectSheetView` — the sheet's entire rendering decision. |
| `apps/merchant/src/lib/sheet-state.test.ts` | Tests for the above. |
| `apps/merchant/src/lib/checkout-session.ts` | `loadCheckoutSession` — server-side loader for `?session=`. |
| `apps/merchant/src/lib/checkout-session.test.ts` | Tests for the above. |
| `apps/merchant/src/lib/order-lines.ts` | `listOrderLines` — order composition for the `/pay` backdrop. |
| `apps/merchant/src/lib/order-lines.test.ts` | Tests for the above. |
| `apps/merchant/src/components/AgeChip.tsx` | The `18+` chip. One definition, three placements. |
| `apps/merchant/src/components/EudiPayRing.tsx` | The twelve-star status ring with its centre glyph. |
| `apps/merchant/src/components/CheckoutPanel.tsx` | Owns the checkout form and the sheet; no navigation. |
| `apps/merchant/src/components/OrderSummary.tsx` | Backdrop content for `/pay/[sessionId]`. |

**Modified:**

| Path | Change |
| --- | --- |
| `packages/ui/src/index.ts` | Export the star geometry. |
| `apps/bank/src/components/EuStars.tsx` | Consume the shared geometry instead of its own copy. |
| `apps/merchant/src/lib/dcql.ts` | Add `isAgeRestricted`; `selectNamedQuery` calls it. |
| `apps/merchant/src/lib/dcql.test.ts` | Cover `isAgeRestricted`. |
| `apps/merchant/src/lib/queries.ts` | `ProductDto.ageRestricted`, derived in `toDto`. |
| `apps/merchant/src/lib/queries.test.ts` | Updated key list; new `ageRestricted` test. |
| `apps/merchant/src/lib/cart.ts` | Add `cartHasAgeRestricted`. |
| `apps/merchant/src/lib/cart.test.ts` | Cover it. |
| `apps/merchant/src/lib/payment-sessions.ts` | Widen `StartPaymentSessionResult`. |
| `apps/merchant/src/lib/payment-sessions.test.ts` | Cover the widened result. |
| `apps/merchant/src/app/api/payment-sessions/route.ts` | Serialise the widened result. |
| `apps/merchant/src/app/layout.tsx` | Load Archivo as `--font-eudipay-face`. |
| `apps/merchant/src/app/globals.css` | `18+` chip, consequence note, the whole sheet. |
| `apps/merchant/src/components/EudiPayLogo.tsx` | **Deleted** in Task 9 — the ring draws the mark, and this was its only consumer. |
| `apps/merchant/src/components/StatusMark.tsx` | **Deleted** in Task 9 — the ring's glyph replaces both marks. |
| `apps/merchant/src/components/PaymentScreen.tsx` | Becomes a renderer over `SheetView`. |
| `apps/merchant/src/components/ProductCard.tsx` | `18+` on the ticket's top line. |
| `apps/merchant/src/components/CheckoutForm.tsx` | Reports the session up; stops navigating and clearing. |
| `apps/merchant/src/app/checkout/page.tsx` | Reads `searchParams`, renders `CheckoutPanel`. |
| `apps/merchant/src/app/cart/page.tsx` | `18+` on cart lines. |
| `apps/merchant/src/app/pay/[sessionId]/page.tsx` | Renders the order summary behind the sheet. |
| `docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md` | §9.4 / §9.5 amendments. |
| `AGENTS.md`, `apps/merchant/AGENTS.md` | New constraints and the measured test count. |

**Projected test additions per task:** T1 +6, T2 +4, T3 +3, T4 +14, T5 +5,
T6 +5, T7–T10 +0, T11 +4, T12 +0. Total +41 → **294**.

---

### Task 1: Shared EU star geometry

`apps/bank/src/components/EuStars.tsx` already generates correct five-pointed
star paths. Spec §3.4 requires the merchant's ring to use the same maths, and
the sheet must draw **stars, not dots**. The geometry moves to `packages/ui`
(behaviour is shared between the apps; design tokens deliberately are not).

**Files:**

- Create: `packages/ui/src/euStars.ts`
- Create: `packages/ui/src/euStars.test.ts`
- Modify: `packages/ui/src/index.ts`
- Modify: `apps/bank/src/components/EuStars.tsx`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export interface RingPoint { x: number; y: number }
  export function ringPoints(cx: number, cy: number, radius: number, count?: number): RingPoint[];
  export function starPath(cx: number, cy: number, outer: number): string;
  ```

  `ringPoints` defaults `count` to 12, starts at twelve o'clock, advances
  clockwise. `starPath` returns a closed SVG path with ten vertices, inner
  radius `outer * 0.382`, coordinates fixed to 2 decimals.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/euStars.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ringPoints, starPath } from "./euStars.js";

describe("ringPoints", () => {
  it("places twelve points by default", () => {
    expect(ringPoints(24, 24, 15)).toHaveLength(12);
  });

  it("starts at twelve o'clock", () => {
    const [first] = ringPoints(24, 24, 15);
    expect(first?.x).toBeCloseTo(24, 6);
    expect(first?.y).toBeCloseTo(9, 6);
  });

  it("advances clockwise — the fourth point is at three o'clock", () => {
    const points = ringPoints(24, 24, 15);
    expect(points[3]?.x).toBeCloseTo(39, 6);
    expect(points[3]?.y).toBeCloseTo(24, 6);
  });

  it("keeps every point on the circle of the given radius", () => {
    for (const point of ringPoints(50, 50, 20)) {
      expect(Math.hypot(point.x - 50, point.y - 50)).toBeCloseTo(20, 6);
    }
  });

  it("honours an explicit count", () => {
    expect(ringPoints(0, 0, 1, 5)).toHaveLength(5);
  });
});

describe("starPath", () => {
  it("draws a closed path of ten vertices", () => {
    const path = starPath(10, 10, 4);
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    // One M, nine L-separated segments: ten vertices.
    expect(path.split("L")).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/ui && pnpm exec vitest run src/euStars.test.ts
```

Expected: FAIL — `Failed to resolve import "./euStars.js"`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/euStars.ts`:

```ts
/**
 * The EU's twelve-star ring, as geometry rather than as a component.
 *
 * Both apps draw this mark — the bank to signal a live credential, the merchant
 * as the payment sheet's status indicator — and both must draw the same stars.
 * Behaviour is shared between the apps; design tokens deliberately are not, so
 * this module returns numbers and path strings and never a colour or a size.
 *
 * Angles start at twelve o'clock and advance clockwise, matching how the mark
 * is read and how a progress indicator built on it is expected to fill.
 */

export interface RingPoint {
  x: number;
  y: number;
}

export function ringPoints(
  cx: number,
  cy: number,
  radius: number,
  count = 12,
): RingPoint[] {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

/**
 * A five-pointed star centred on (cx, cy). The 0.382 inner ratio is the one the
 * EU flag's construction implies, and is what the bank's mark already used.
 */
export function starPath(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.382;
  const vertices: string[] = [];

  for (let step = 0; step < 10; step++) {
    const radius = step % 2 === 0 ? outer : inner;
    const angle = (step / 10) * Math.PI * 2 - Math.PI / 2;
    vertices.push(
      `${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`,
    );
  }

  return `M${vertices.join("L")}Z`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/ui && pnpm exec vitest run src/euStars.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Export it and make the bank consume it**

In `packages/ui/src/index.ts`, add after the `cn` export:

```ts
export { ringPoints, starPath } from "./euStars.js";
export type { RingPoint } from "./euStars.js";
```

Rewrite `apps/bank/src/components/EuStars.tsx` — delete its local `star()`
function and consume the shared geometry:

```tsx
import { ringPoints, starPath } from "@demo/ui";

/**
 * The EU's twelve-star ring, drawn rather than typed as the 🇪🇺 emoji — flag
 * emoji render as the letters "EU" on Windows and as a different shape on
 * every platform, which is not acceptable for a mark that signals "this
 * credential is live".
 *
 * Rendered in currentColor so it inherits whatever surface it sits on and
 * introduces no colour of its own. The geometry lives in @demo/ui because the
 * merchant's payment sheet draws the same stars.
 */
export function EuStars({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {ringPoints(24, 24, 15).map((point, index) => (
        <path key={index} d={starPath(point.x, point.y, 3.1)} />
      ))}
    </svg>
  );
}
```

- [ ] **Step 6: Verify nothing regressed**

```bash
pnpm check
```

Expected: PASS, **259 tests** (253 + 6). Report the number you actually see.

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/euStars.ts packages/ui/src/euStars.test.ts \
  packages/ui/src/index.ts apps/bank/src/components/EuStars.tsx
git commit -m "feat(ui): share the EU twelve-star geometry between both apps"
```

---

### Task 2: `isAgeRestricted` and the derived DTO field

Spec §7.1. `AGE_RESTRICTED_PRODUCT_IDS` stays hardcoded in `dcql.ts` — a tag is
a second *reader*, not a second writer, so the comment's condition for promoting
it to the schema is not met. `selectNamedQuery` is refactored to call the new
predicate so the storefront tag and the `dpc` → `dpc_av` escalation cannot
disagree.

`dcql.ts` is safe to import from a client component: its only non-pure import is
`import type { NamedQueryRef } from "../db/schema.js"`, which is type-only and
erased at compile time. Do not change that to a value import.

**Files:**

- Modify: `apps/merchant/src/lib/dcql.ts`
- Modify: `apps/merchant/src/lib/dcql.test.ts`
- Modify: `apps/merchant/src/lib/queries.ts`
- Modify: `apps/merchant/src/lib/queries.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:

  ```ts
  // lib/dcql.ts
  export function isAgeRestricted(productId: string): boolean;
  // lib/queries.ts — ProductDto gains:
  ageRestricted: boolean;
  ```

- [ ] **Step 1: Write the failing tests**

In `apps/merchant/src/lib/dcql.test.ts`, add `isAgeRestricted` to the existing
import from `./dcql.js`, then add a new `describe` block immediately before
`describe("selectNamedQuery"`:

```ts
describe("isAgeRestricted", () => {
  it("is true for exactly the three restricted products", () => {
    for (const id of ["beer", "wine", "aperitif"]) {
      expect(isAgeRestricted(id)).toBe(true);
    }
  });

  it("is false for every other seeded product", () => {
    const ordinary = [
      "tomatoes", "avocado", "berries", "sourdough", "milk", "yogurt",
      "cheese", "pasta", "olive-oil", "chocolate", "chips", "water",
    ];
    for (const id of ordinary) {
      expect(isAgeRestricted(id)).toBe(false);
    }
  });

  it("agrees with selectNamedQuery — one source of truth", () => {
    // The shelf tag and the dpc -> dpc_av escalation must never disagree.
    for (const id of ["beer", "wine", "aperitif", "cheese", "water"]) {
      expect(selectNamedQuery([id]) === "dpc_av").toBe(isAgeRestricted(id));
    }
  });
});
```

In `apps/merchant/src/lib/queries.test.ts`, **modify** the existing
`"exposes the fields the storefront renders"` assertion so the sorted key list
starts with the new key:

```ts
    expect(Object.keys(first ?? {}).sort()).toEqual([
      "ageRestricted",
      "baseQuantity",
      "baseUnit",
      "category",
      "description",
      "id",
      "imageUrl",
      "name",
      "packLabel",
      "priceCents",
    ]);
```

and add one new test inside the same `describe("listProducts"` block:

```ts
  it("marks exactly the three age-restricted products", () => {
    const restricted = listProducts(db)
      .filter((product) => product.ageRestricted)
      .map((product) => product.id)
      .sort();
    expect(restricted).toEqual(["aperitif", "beer", "wine"]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/dcql.test.ts src/lib/queries.test.ts
```

Expected: FAIL — `isAgeRestricted` is not exported, and `ageRestricted` is
missing from the DTO key list.

- [ ] **Step 3: Implement the predicate**

In `apps/merchant/src/lib/dcql.ts`, immediately after the `RESTRICTED` set, add:

```ts
/**
 * Whether buying this product requires proving an age. The storefront renders a
 * tag from this and `selectNamedQuery` escalates from it, so the shelf can never
 * promise a check the presentation does not ask for.
 */
export function isAgeRestricted(productId: string): boolean {
  return RESTRICTED.has(productId);
}
```

and change `selectNamedQuery`'s body to call it:

```ts
export function selectNamedQuery(productIds: readonly string[]): NamedQueryRef {
  return productIds.some(isAgeRestricted) ? "dpc_av" : "dpc";
}
```

- [ ] **Step 4: Add the derived DTO field**

In `apps/merchant/src/lib/queries.ts` add the import:

```ts
import { isAgeRestricted } from "./dcql.js";
```

add the field to `ProductDto` after `baseUnit`:

```ts
  /**
   * Derived, never stored. The restricted set lives in `lib/dcql.ts` beside the
   * named-query escalation it drives; a column here would imply an editing
   * surface that does not exist.
   */
  ageRestricted: boolean;
```

and set it in `toDto`, after `baseUnit: row.baseUnit,`:

```ts
    ageRestricted: isAgeRestricted(row.id),
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/dcql.test.ts src/lib/queries.test.ts
```

Expected: PASS.

- [ ] **Step 6: Verify the whole gate**

```bash
pnpm check
```

Expected: PASS, **263 tests** (259 + 4). Report the measured number.

- [ ] **Step 7: Commit**

```bash
git add apps/merchant/src/lib/dcql.ts apps/merchant/src/lib/dcql.test.ts \
  apps/merchant/src/lib/queries.ts apps/merchant/src/lib/queries.test.ts
git commit -m "feat(merchant): derive an ageRestricted flag from the escalation set"
```

---

### Task 3: The `18+` chip, its three placements, and the consequence line

Spec §7.2 and §7.3. The chip is in **Larder's** palette, not EudiPay's — the
restriction is the grocer's obligation. The checkout consequence line is derived
from the live cart, so a new pure helper carries that decision.

**Files:**

- Modify: `apps/merchant/src/lib/cart.ts`
- Modify: `apps/merchant/src/lib/cart.test.ts`
- Create: `apps/merchant/src/components/AgeChip.tsx`
- Modify: `apps/merchant/src/app/globals.css`
- Modify: `apps/merchant/src/components/ProductCard.tsx`
- Modify: `apps/merchant/src/app/cart/page.tsx`
- Modify: `apps/merchant/src/components/CheckoutForm.tsx`

**Interfaces:**

- Consumes: `isAgeRestricted` from Task 2.
- Produces:

  ```ts
  // lib/cart.ts
  export function cartHasAgeRestricted(items: CartItem[]): boolean;
  // components/AgeChip.tsx
  export function AgeChip({ className }: { className?: string }): JSX.Element;
  ```

- [ ] **Step 1: Write the failing test**

In `apps/merchant/src/lib/cart.test.ts`, add `cartHasAgeRestricted` to the
existing import from `./cart.js`, then append:

```ts
describe("cartHasAgeRestricted", () => {
  const ordinary = { productId: "cheese", name: "Aged Gouda", priceCents: 449, quantity: 1 };
  const restricted = { productId: "wine", name: "Riesling, Trocken", priceCents: 899, quantity: 1 };

  it("is true when a restricted product is in the basket", () => {
    expect(cartHasAgeRestricted([ordinary, restricted])).toBe(true);
  });

  it("is false for an all-ordinary basket", () => {
    expect(cartHasAgeRestricted([ordinary])).toBe(false);
  });

  it("is false for an empty basket", () => {
    expect(cartHasAgeRestricted([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/cart.test.ts
```

Expected: FAIL — `cartHasAgeRestricted` is not exported.

- [ ] **Step 3: Implement it**

In `apps/merchant/src/lib/cart.ts` add the import:

```ts
import { isAgeRestricted } from "./dcql.js";
```

and append:

```ts
/**
 * Whether this basket will be presented with the `dpc_av` named query. Derived
 * from `productId` against the same set `selectNamedQuery` uses, so the
 * checkout's promise and the actual presentation cannot drift apart.
 */
export function cartHasAgeRestricted(items: CartItem[]): boolean {
  return items.some((row) => isAgeRestricted(row.productId));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/cart.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the chip's styles**

In `apps/merchant/src/app/globals.css`, first amend the ticket-rail comment so it
no longer claims a single use. Replace:

```css
/* The yellow rail of a supermarket shelf label — the page's only warm colour. */
```

with:

```css
/* The yellow rail of a supermarket shelf label. The shop's only warm colour,
 * used twice: here, and as the ink of the 18+ chip. */
```

Then append a new section at the very end of the file:

```css
/* --------------------------------------------------------- age marking ---- */

/*
 * The 18+ chip. Deliberately in Larder's palette rather than EudiPay's: an age
 * restriction is the grocer's legal obligation and belongs to the shop's voice.
 * The payment sheet mentions the check in running copy and never wears this
 * chip.
 *
 * `18+`, not `+18` — that is the form printed on European shelf edges.
 */
.age-chip {
  display: inline-flex;
  align-items: center;
  flex: none;
  background: var(--color-ink);
  color: var(--color-ticket);
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  line-height: 1.4;
  border-radius: 3px;
  padding: 1px 5px;
}

/*
 * The consequence line above the checkout button. It says what will happen and
 * then what will not, which is the claim this whole demo exists to make.
 */
.age-note {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  border: 1px solid var(--color-border);
  border-left: 3px solid var(--color-ticket);
  border-radius: 0.5rem;
  background: var(--color-surface);
  font-size: 0.8125rem;
  line-height: 1.5;
  color: var(--color-muted-foreground);
}
```

Do **not** hand-write an `.sr-only` rule. Tailwind v4 ships `sr-only` as a core
static utility with exactly those declarations (verified in
`node_modules/tailwindcss/dist/lib.mjs`), and a hand-rolled copy in this file
would sit *outside* Tailwind's layers — where, as the header comment notes,
component classes beat utilities. That would override the real utility with a
duplicate for no gain.

- [ ] **Step 6: Create the chip component**

Create `apps/merchant/src/components/AgeChip.tsx`:

```tsx
/**
 * One definition, three placements: the shelf ticket, the cart line, and the
 * checkout basket line. The success receipt deliberately does not carry it —
 * the purchase is complete and the restriction is no longer actionable.
 *
 * The visible glyph is a graphic shorthand, so the meaning is spelled out for a
 * screen reader rather than left to "eighteen plus".
 */
export function AgeChip({ className }: { className?: string }) {
  return (
    <span className={className ? `age-chip ${className}` : "age-chip"}>
      <span className="sr-only">Age restricted: </span>18+
    </span>
  );
}
```

- [ ] **Step 7: Place it on the shelf ticket**

In `apps/merchant/src/components/ProductCard.tsx` add the import:

```tsx
import { AgeChip } from "./AgeChip.js";
```

and replace the `<h3 className="ticket-name">{product.name}</h3>` line with a
flex row, so the chip sits opposite the name on the ticket's top line:

```tsx
        <div className="flex items-start justify-between gap-2">
          <h3 className="ticket-name">{product.name}</h3>
          {product.ageRestricted ? <AgeChip className="mt-0.5" /> : null}
        </div>
```

- [ ] **Step 8: Place it on the cart line**

In `apps/merchant/src/app/cart/page.tsx` add the imports:

```tsx
import { AgeChip } from "@/components/AgeChip.js";
import { isAgeRestricted } from "@/lib/dcql.js";
```

and replace `<p className="font-semibold">{item.name}</p>` with:

```tsx
                    <p className="flex items-center gap-2 font-semibold">
                      {item.name}
                      {isAgeRestricted(item.productId) ? <AgeChip /> : null}
                    </p>
```

- [ ] **Step 9: Place it on the checkout basket line and add the consequence line**

In `apps/merchant/src/components/CheckoutForm.tsx` add the imports:

```tsx
import { AgeChip } from "./AgeChip.js";
import { cartHasAgeRestricted } from "@/lib/cart.js";
import { isAgeRestricted } from "@/lib/dcql.js";
```

In the basket `<aside>`, inside the `<span className="min-w-0">`, replace the
bare `{item.name}` with:

```tsx
                {item.name}
                {isAgeRestricted(item.productId) ? <AgeChip className="ml-1.5" /> : null}
```

Immediately **above** the submit `<button>`, add:

```tsx
        {cartHasAgeRestricted(items) ? (
          <div className="age-note px-3.5 py-3">
            <AgeChip />
            <span>
              Your wallet will confirm you&rsquo;re over 18. It won&rsquo;t share your
              date of birth.
            </span>
          </div>
        ) : null}
```

- [ ] **Step 10: Verify the gate**

```bash
pnpm check
```

Expected: PASS, **266 tests** (263 + 3). Report the measured number.

- [ ] **Step 11: Verify in a real browser**

```bash
pnpm build
pnpm --filter @demo/merchant start &
```

Drive the running server with `tools/cdp/cdp.mjs` (read its `--help` first) and
confirm:

- The shop page shows `18+` on exactly three tickets — Unfiltered Lager,
  Riesling Trocken, Amber Aperitif — and on no others.
- Adding Riesling then visiting `/checkout` shows the consequence line; removing
  it from `/cart` makes the line disappear.

Do not assert on server-rendered HTML in place of this; the cart lives in
`localStorage` and only a real browser exercises it.

- [ ] **Step 12: Commit**

```bash
git add apps/merchant/src/lib/cart.ts apps/merchant/src/lib/cart.test.ts \
  apps/merchant/src/components/AgeChip.tsx apps/merchant/src/app/globals.css \
  apps/merchant/src/components/ProductCard.tsx apps/merchant/src/app/cart/page.tsx \
  apps/merchant/src/components/CheckoutForm.tsx
git commit -m "feat(merchant): mark age-restricted items and say what the wallet will prove"
```

---

### Task 4: `selectSheetView` — the sheet's state machine

Spec §4. The current `PaymentScreen` decides everything through nested ternaries
inside JSX, which is why a spacing defect in one branch is invisible from the
others. The decision moves into a pure module so vitest reaches it.

This task ships **no UI change**. It is the tested decision layer Task 9 renders.

**Files:**

- Create: `apps/merchant/src/lib/sheet-state.ts`
- Create: `apps/merchant/src/lib/sheet-state.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export type SheetPhase = "authorise" | "waiting" | "settling" | "approved" | "declined";
  export type SheetGlyph = "card" | "check" | "alert";
  export type SheetAction = "approve" | "retry" | "show-qr" | null;
  export type DcError = "unsupported" | "failed" | null;

  export interface SheetInput {
    state: string;
    transport: "request_uri" | "dc_api";
    ageRequested: boolean;
    redirecting: boolean;
    dcBusy: boolean;
    dcError: DcError;
    pollStatus: "running" | "failed" | "timeout" | null;
    failureReason?: string;
  }

  export interface SheetView {
    phase: SheetPhase;
    eyebrow: string;
    litStars: number;
    glyph: SheetGlyph;
    animate: boolean;
    pill: string | null;
    headline: string | null;
    body: string;
    showQr: boolean;
    showWalletButton: boolean;
    primaryAction: SheetAction;
    showCancel: boolean;
    showBackToShop: boolean;
  }

  export function selectSheetView(input: SheetInput): SheetView;
  ```

  `FAILURE_MESSAGE` is module-private, **not exported** — nothing outside this
  module reads it, and `knip` flags unused exports. The tests assert the resulting
  `body` strings instead, which is what a shopper actually sees.

  `pollStatus` is a narrowed projection of `@demo/ui`'s `PollOutcome`, whose real
  union is `"terminal" | "timeout" | "failed" | "aborted"`. Only `timeout` and
  `failed` change what the sheet shows; `terminal` is already expressed by `state`
  becoming `completed`/`failed`, and `aborted` only happens on unmount. The
  component does that narrowing (Task 9), so this module never sees the other two.

Note on `litStars` + `animate`: a pure function cannot animate, so `litStars` is
what the ring shows when it is **static**. `animate: true` tells the component to
cycle 1 → 12 at one star per 400ms; under `prefers-reduced-motion: reduce` it
renders `litStars` instead, which spec §3.4 fixes at 6 for the waiting states.

- [ ] **Step 1: Write the failing test**

Create `apps/merchant/src/lib/sheet-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectSheetView, type SheetInput } from "./sheet-state.js";

const base: SheetInput = {
  state: "pending",
  transport: "request_uri",
  ageRequested: false,
  redirecting: false,
  dcBusy: false,
  dcError: null,
  pollStatus: "running",
};

describe("selectSheetView — waiting states", () => {
  it("shows a QR and the waiting pill for a request_uri session", () => {
    const view = selectSheetView(base);
    expect(view.phase).toBe("waiting");
    expect(view.showQr).toBe(true);
    expect(view.showWalletButton).toBe(false);
    expect(view.pill).toBe("Waiting for your wallet");
    expect(view.litStars).toBe(6);
    expect(view.animate).toBe(true);
    expect(view.glyph).toBe("card");
    expect(view.showCancel).toBe(true);
    expect(view.primaryAction).toBeNull();
  });

  it("shows no QR while redirecting to a wallet deep link", () => {
    const view = selectSheetView({ ...base, redirecting: true });
    expect(view.showQr).toBe(false);
    expect(view.pill).toBe("Opening your wallet…");
    expect(view.body).toBe(
      "Approve the payment in your EUDI Wallet, then come back to this tab.",
    );
  });

  it("offers the wallet button and no pill before a dc_api press", () => {
    const view = selectSheetView({ ...base, transport: "dc_api" });
    expect(view.phase).toBe("authorise");
    expect(view.showQr).toBe(false);
    expect(view.showWalletButton).toBe(true);
    expect(view.primaryAction).toBe("approve");
    // Nothing is waiting until the button is pressed.
    expect(view.pill).toBeNull();
    expect(view.litStars).toBe(4);
    expect(view.animate).toBe(false);
  });

  it("moves to waiting once the dc_api call is in flight", () => {
    const view = selectSheetView({ ...base, transport: "dc_api", dcBusy: true });
    expect(view.phase).toBe("waiting");
    expect(view.pill).toBe("Opening your wallet…");
    expect(view.animate).toBe(true);
    expect(view.litStars).toBe(6);
    expect(view.showWalletButton).toBe(false);
  });
});

describe("selectSheetView — settling", () => {
  it("lights eleven stars and withdraws cancel", () => {
    const view = selectSheetView({ ...base, state: "settling" });
    expect(view.phase).toBe("settling");
    expect(view.litStars).toBe(11);
    expect(view.pill).toBe("Contacting your bank…");
    // The money is in flight; a cancel that cannot cancel is a lie.
    expect(view.showCancel).toBe(false);
    expect(view.showQr).toBe(false);
  });
});

describe("selectSheetView — terminal states", () => {
  it("completes the ring and flips the eyebrow on success", () => {
    const view = selectSheetView({ ...base, state: "completed", pollStatus: null });
    expect(view.phase).toBe("approved");
    expect(view.eyebrow).toBe("Paid");
    expect(view.litStars).toBe(12);
    expect(view.glyph).toBe("check");
    expect(view.headline).toBe("Payment approved");
    expect(view.showCancel).toBe(false);
    expect(view.showBackToShop).toBe(false);
  });

  it("empties the ring and offers a retry on a decline", () => {
    const view = selectSheetView({
      ...base,
      state: "failed",
      failureReason: "insufficient_funds",
      pollStatus: null,
    });
    expect(view.phase).toBe("declined");
    expect(view.eyebrow).toBe("Not paid");
    expect(view.litStars).toBe(0);
    expect(view.glyph).toBe("alert");
    expect(view.headline).toBe("Payment declined");
    expect(view.body).toBe("Payment was declined by your bank.");
    expect(view.primaryAction).toBe("retry");
    expect(view.showBackToShop).toBe(true);
    expect(view.showCancel).toBe(false);
  });

  it("offers no retry for a payment the shopper cancelled", () => {
    const view = selectSheetView({
      ...base,
      state: "failed",
      failureReason: "cancelled",
      pollStatus: null,
    });
    expect(view.primaryAction).toBeNull();
    expect(view.showBackToShop).toBe(true);
  });

  it("declines with a connection message when polling fails", () => {
    const view = selectSheetView({ ...base, pollStatus: "failed" });
    expect(view.phase).toBe("declined");
    expect(view.body).toBe("Lost connection to the payment service.");
  });

  it("declines with an expiry message when polling times out", () => {
    const view = selectSheetView({ ...base, pollStatus: "timeout" });
    expect(view.phase).toBe("declined");
    expect(view.body).toBe("This payment request expired.");
  });

  it("falls back to a generic message for an unmapped failure reason", () => {
    const view = selectSheetView({
      ...base,
      state: "failed",
      failureReason: "something_new",
      pollStatus: null,
    });
    expect(view.body).toBe("The payment could not be completed.");
  });
});

describe("selectSheetView — dc_api recovery", () => {
  it("offers the QR fallback when the browser cannot open a wallet", () => {
    const view = selectSheetView({
      ...base,
      transport: "dc_api",
      dcError: "unsupported",
    });
    expect(view.phase).toBe("declined");
    expect(view.headline).toBe("Couldn't open your wallet");
    expect(view.body).toBe(
      "This browser does not support the Digital Credentials API.",
    );
    expect(view.primaryAction).toBe("show-qr");
    // A dc_api session is bound to response_mode dc_api.jwt and can never be
    // re-rendered as a QR; recovery is a fresh request_uri session.
    expect(view.showQr).toBe(false);
    expect(view.showWalletButton).toBe(false);
  });

  it("distinguishes a failed invocation from an unsupported browser", () => {
    const view = selectSheetView({ ...base, transport: "dc_api", dcError: "failed" });
    expect(view.body).toBe("Could not open your wallet on this device.");
    expect(view.primaryAction).toBe("show-qr");
  });
});

describe("selectSheetView — the age clause", () => {
  it("adds the age clause to the QR instruction and changes nothing else", () => {
    const plain = selectSheetView(base);
    const aged = selectSheetView({ ...base, ageRequested: true });
    expect(plain.body).toBe("Scan with your EUDI Wallet to approve the payment.");
    expect(aged.body).toBe(
      "Scan with your EUDI Wallet to approve the payment and confirm you're over 18.",
    );
    // Only `body` may differ — the age clause is copy, not a layout change.
    expect({ ...aged, body: plain.body }).toEqual(plain);
  });

  it("adds the age clause to the same-device instruction", () => {
    const aged = selectSheetView({
      ...base,
      transport: "dc_api",
      ageRequested: true,
    });
    expect(aged.body).toBe(
      "Your wallet will confirm the amount and that you're over 18.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/sheet-state.test.ts
```

Expected: FAIL — `Failed to resolve import "./sheet-state.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/merchant/src/lib/sheet-state.ts`:

```ts
/**
 * Everything the EudiPay sheet renders, as one pure decision.
 *
 * This used to be a stack of nested ternaries inside PaymentScreen's JSX, which
 * is exactly why a spacing defect in one branch was invisible from the others.
 * Keeping the decision here also makes it testable: every vitest project runs
 * `environment: "node"` and matches only `src/**\/*.test.ts`, so nothing in a
 * `.tsx` file is ever covered.
 *
 * `litStars` is what the ring shows when it is NOT animating. `animate: true`
 * tells the component to cycle 1 -> 12; under prefers-reduced-motion it renders
 * `litStars` instead, which is why the waiting states carry 6 rather than 0.
 */

export type SheetPhase =
  | "authorise"
  | "waiting"
  | "settling"
  | "approved"
  | "declined";

export type SheetGlyph = "card" | "check" | "alert";

export type SheetAction = "approve" | "retry" | "show-qr" | null;

/** Why a Digital Credentials API invocation did not produce a credential. */
export type DcError = "unsupported" | "failed" | null;

export interface SheetInput {
  state: string;
  transport: "request_uri" | "dc_api";
  ageRequested: boolean;
  redirecting: boolean;
  dcBusy: boolean;
  dcError: DcError;
  pollStatus: "running" | "failed" | "timeout" | null;
  failureReason?: string;
}

export interface SheetView {
  phase: SheetPhase;
  eyebrow: string;
  litStars: number;
  glyph: SheetGlyph;
  animate: boolean;
  pill: string | null;
  headline: string | null;
  body: string;
  showQr: boolean;
  showWalletButton: boolean;
  primaryAction: SheetAction;
  showCancel: boolean;
  showBackToShop: boolean;
}

/**
 * Spec §6.3's failure table, in the shopper's words rather than the code's.
 *
 * Deliberately NOT exported: nothing outside this module needs it, and an unused
 * export is something `knip` reports. Tests assert the `body` string that comes
 * out of `selectSheetView`, which is what a shopper actually reads.
 */
const FAILURE_MESSAGE: Record<string, string> = {
  cancelled: "This payment was cancelled.",
  verification_failed: "Your card could not be verified.",
  transaction_data_binding_failed:
    "The amount could not be confirmed against your wallet's approval.",
  age_verification_failed: "Your age could not be confirmed.",
  insufficient_funds: "Payment was declined by your bank.",
  credential_invalid: "This card is no longer valid.",
  bank_unreachable: "Could not reach your bank. Nothing was charged.",
  foundry_unavailable: "The payment service is unavailable. Please try again.",
};

const AUTHORISE = "Amount to authorise";

function declined(
  headline: string,
  body: string,
  action: SheetAction,
): SheetView {
  return {
    phase: "declined",
    eyebrow: "Not paid",
    litStars: 0,
    glyph: "alert",
    animate: false,
    pill: null,
    headline,
    body,
    showQr: false,
    showWalletButton: false,
    primaryAction: action,
    showCancel: false,
    showBackToShop: true,
  };
}

export function selectSheetView(input: SheetInput): SheetView {
  // Terminal outcomes first: a declined payment must never keep offering a QR.
  if (input.pollStatus === "timeout") {
    return declined("Payment declined", "This payment request expired.", "retry");
  }

  if (input.pollStatus === "failed") {
    return declined(
      "Payment declined",
      "Lost connection to the payment service.",
      "retry",
    );
  }

  if (input.state === "failed") {
    return declined(
      "Payment declined",
      (input.failureReason && FAILURE_MESSAGE[input.failureReason]) ||
        "The payment could not be completed.",
      input.failureReason === "cancelled" ? null : "retry",
    );
  }

  if (input.state === "completed") {
    return {
      phase: "approved",
      eyebrow: "Paid",
      litStars: 12,
      glyph: "check",
      animate: false,
      pill: null,
      headline: "Payment approved",
      body: "Taking you to your receipt…",
      showQr: false,
      showWalletButton: false,
      primaryAction: null,
      showCancel: false,
      showBackToShop: false,
    };
  }

  // A dc_api session that could not reach a wallet is not a decline, but it
  // reuses the declined layout because the recovery is the same shape.
  if (input.dcError !== null) {
    return declined(
      "Couldn't open your wallet",
      input.dcError === "unsupported"
        ? "This browser does not support the Digital Credentials API."
        : "Could not open your wallet on this device.",
      "show-qr",
    );
  }

  if (input.state === "settling") {
    return {
      phase: "settling",
      eyebrow: AUTHORISE,
      litStars: 11,
      glyph: "card",
      animate: true,
      pill: "Contacting your bank…",
      headline: null,
      body: "Your wallet approved the payment. Don't close this tab.",
      showQr: false,
      showWalletButton: false,
      primaryAction: null,
      // The money is in flight. There is nothing left to cancel.
      showCancel: false,
      showBackToShop: false,
    };
  }

  if (input.redirecting) {
    return {
      phase: "waiting",
      eyebrow: AUTHORISE,
      litStars: 6,
      glyph: "card",
      animate: true,
      pill: "Opening your wallet…",
      headline: null,
      body: "Approve the payment in your EUDI Wallet, then come back to this tab.",
      showQr: false,
      showWalletButton: false,
      primaryAction: null,
      showCancel: true,
      showBackToShop: false,
    };
  }

  if (input.transport === "dc_api") {
    const body = input.ageRequested
      ? "Your wallet will confirm the amount and that you're over 18."
      : "Your wallet will confirm the amount.";

    if (input.dcBusy) {
      return {
        phase: "waiting",
        eyebrow: AUTHORISE,
        litStars: 6,
        glyph: "card",
        animate: true,
        pill: "Opening your wallet…",
        headline: null,
        body,
        showQr: false,
        showWalletButton: false,
        primaryAction: null,
        showCancel: true,
        showBackToShop: false,
      };
    }

    return {
      phase: "authorise",
      eyebrow: AUTHORISE,
      litStars: 4,
      glyph: "card",
      animate: false,
      // Nothing is waiting until the shopper presses the button.
      pill: null,
      headline: null,
      body,
      showQr: false,
      showWalletButton: true,
      primaryAction: "approve",
      showCancel: true,
      showBackToShop: false,
    };
  }

  return {
    phase: "waiting",
    eyebrow: AUTHORISE,
    litStars: 6,
    glyph: "card",
    animate: true,
    pill: "Waiting for your wallet",
    headline: null,
    body: input.ageRequested
      ? "Scan with your EUDI Wallet to approve the payment and confirm you're over 18."
      : "Scan with your EUDI Wallet to approve the payment.",
    showQr: true,
    showWalletButton: false,
    primaryAction: null,
    showCancel: true,
    showBackToShop: false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/sheet-state.test.ts
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Verify the gate**

```bash
pnpm check
```

Expected: PASS, **280 tests** (266 + 14). Report the measured number.

- [ ] **Step 6: Commit**

```bash
git add apps/merchant/src/lib/sheet-state.ts apps/merchant/src/lib/sheet-state.test.ts
git commit -m "feat(merchant): move the payment sheet's rendering decision into a tested module"
```

---

### Task 5: Widen the payment-session result

Spec §5.4. The sheet needs amount, transport, age flag and DC API payload as
props **before any click**. There are no tests anywhere under merchant `src/app`,
so the new fields go on `startPaymentSession`'s result — inside the already-tested
surface — and the route handler only serialises them.

**Files:**

- Modify: `apps/merchant/src/lib/payment-sessions.ts`
- Modify: `apps/merchant/src/lib/payment-sessions.test.ts`
- Modify: `apps/merchant/src/app/api/payment-sessions/route.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export type StartPaymentSessionResult =
    | {
        ok: true;
        sessionId: string;
        uri: string | null;
        orderId: string;
        amountCents: number;
        transport: "request_uri" | "dc_api";
        ageRequested: boolean;
        dcApiRequest: unknown;
        state: "pending";
      }
    | { ok: false; reason: "order_not_found" | "order_not_pending" | "foundry_unavailable" };
  ```

  `uri` is `null` for a `dc_api` session (foundry returns neither
  `openid4vp_uri` nor `request_uri` for an inlined request object) and
  `dcApiRequest` is `null` for a `request_uri` session.

- [ ] **Step 1: Read the existing test file before writing anything**

```bash
cd apps/merchant && cat src/lib/payment-sessions.test.ts
```

It already builds a temp database and a fake `FoundryClient`. **Reuse its
existing fixtures and helper style** — do not invent a parallel set, and do not
modify the existing tests.

- [ ] **Step 2: Write the failing test**

Append a new `describe` block to `apps/merchant/src/lib/payment-sessions.test.ts`.
Adapt the fixture calls to the helpers that file already defines; the assertions
below are what must hold:

```ts
describe("startPaymentSession — the result the sheet is built from", () => {
  it("reports the amount from the order row, not from the caller", async () => {
    // The sheet shows this number and it must be the one bound into
    // transaction_data, so it can only come from the order.
    const { db, client, orderId, totalCents } = await pendingOrder(["cheese"]);
    const result = await startPaymentSession(db, client, orderId, "Larder", "PAYEE-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.amountCents).toBe(totalCents);
    expect(result.orderId).toBe(orderId);
    expect(result.state).toBe("pending");
  });

  it("reports a request_uri session with no dc_api payload", async () => {
    const { db, client, orderId } = await pendingOrder(["cheese"]);
    const result = await startPaymentSession(
      db, client, orderId, "Larder", "PAYEE-1", false,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe("request_uri");
    expect(result.dcApiRequest).toBeNull();
    expect(typeof result.uri).toBe("string");
  });

  it("reports a dc_api session with no uri", async () => {
    const { db, client, orderId } = await pendingOrder(["cheese"], { dcApi: true });
    const result = await startPaymentSession(
      db, client, orderId, "Larder", "PAYEE-1", true,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transport).toBe("dc_api");
    expect(result.uri).toBeNull();
    expect(result.dcApiRequest).not.toBeNull();
  });

  it("reports ageRequested for an age-restricted basket", async () => {
    const { db, client, orderId } = await pendingOrder(["cheese", "wine"]);
    const result = await startPaymentSession(db, client, orderId, "Larder", "PAYEE-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ageRequested).toBe(true);
  });

  it("reports ageRequested false for an ordinary basket", async () => {
    const { db, client, orderId } = await pendingOrder(["cheese"]);
    const result = await startPaymentSession(db, client, orderId, "Larder", "PAYEE-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ageRequested).toBe(false);
  });
});
```

If the file has no `pendingOrder`-shaped helper, write one **at the top of your
new describe block** in the file's existing style: create the temp db, `seed(db)`,
`createOrder(db, lines, customer)`, and a fake `FoundryClient` whose
`createVerificationRequest` returns
`{ verification_id, openid4vp_uri, request_uri }` for `request_uri` and
`{ verification_id, dc_api_request: { response_mode: "dc_api.jwt" } }` for
`dc_api`.

- [ ] **Step 3: Run test to verify it fails**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/payment-sessions.test.ts
```

Expected: FAIL — `amountCents`, `transport`, `ageRequested` and `dcApiRequest`
do not exist on `StartPaymentSessionResult`.

- [ ] **Step 4: Widen the result type**

In `apps/merchant/src/lib/payment-sessions.ts`, replace the whole
`StartPaymentSessionResult` type with:

```ts
/**
 * Everything the payment sheet renders, returned from here rather than
 * re-fetched. The sheet must hold the DC API request object as a prop before
 * any click: Chrome consumes a click's transient activation, so no `await` may
 * run between the handler starting and navigator.credentials.get().
 */
export type StartPaymentSessionResult =
  | {
      ok: true;
      sessionId: string;
      /** Null under dc_api — foundry inlines the request object instead. */
      uri: string | null;
      orderId: string;
      /** From the order row. Never from the browser. */
      amountCents: number;
      transport: "request_uri" | "dc_api";
      /** True when this session presents the `dpc_av` named query. */
      ageRequested: boolean;
      /** foundry's inline unsigned request object. Null under request_uri. */
      dcApiRequest: unknown;
      state: "pending";
    }
  | {
      ok: false;
      reason: "order_not_found" | "order_not_pending" | "foundry_unavailable";
    };
```

- [ ] **Step 5: Return the new fields**

Inside the `try` block, replace the `const uri = …` line with:

```ts
    // Under dc_api foundry returns neither uri — the request object is inlined
    // and unsigned because response_mode is dc_api.jwt.
    const uri = response.openid4vp_uri ?? response.request_uri ?? null;
    const dcApiRequest =
      response.dc_api_request === undefined || response.dc_api_request === null
        ? null
        : response.dc_api_request;
```

In the existing `db.update(paymentSessions).set({...})` call, replace the
`dcApiRequestJson:` entry with:

```ts
        dcApiRequestJson: dcApiRequest === null ? null : JSON.stringify(dcApiRequest),
```

and replace `return { ok: true, sessionId, uri };` with:

```ts
    return {
      ok: true,
      sessionId,
      uri,
      orderId: order.id,
      amountCents: order.totalCents,
      transport: useDcApi ? "dc_api" : "request_uri",
      ageRequested: namedQueryRef === "dpc_av",
      dcApiRequest,
      state: "pending",
    };
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/payment-sessions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Serialise it from the route**

In `apps/merchant/src/app/api/payment-sessions/route.ts`, replace the final
`return NextResponse.json(...)` with:

```ts
  // The sheet is built entirely from this body — see lib/sheet-state.ts. `uri`
  // keeps its name so the existing caller is unaffected.
  return NextResponse.json(
    {
      sessionId: result.sessionId,
      uri: result.uri,
      orderId: result.orderId,
      amountCents: result.amountCents,
      transport: result.transport,
      ageRequested: result.ageRequested,
      dcApiRequest: result.dcApiRequest,
      state: result.state,
    },
    { status: 201 },
  );
```

- [ ] **Step 8: Verify the gate**

```bash
pnpm check
```

Expected: PASS, **285 tests** (280 + 5). Report the measured number.

- [ ] **Step 9: Commit**

```bash
git add apps/merchant/src/lib/payment-sessions.ts \
  apps/merchant/src/lib/payment-sessions.test.ts \
  apps/merchant/src/app/api/payment-sessions/route.ts
git commit -m "feat(merchant): return the sheet's whole prop set when a session starts"
```

---

### Task 6: `loadCheckoutSession` — surviving the wallet round trip

Spec §5.2. On a coarse pointer the sheet sets `window.location.href` and the tab
leaves the page. When the wallet returns the shopper, `/checkout` re-mounts from
scratch; without `?session=` they land on a bare form.

**Files:**

- Create: `apps/merchant/src/lib/checkout-session.ts`
- Create: `apps/merchant/src/lib/checkout-session.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export interface SheetSession {
    sessionId: string;
    orderId: string;
    amountCents: number;
    openid4vpUri: string;
    transport: "request_uri" | "dc_api";
    ageRequested: boolean;
    dcApiRequest: unknown;
    initialState: string;
    initialFailureReason?: string;
  }
  export function loadCheckoutSession(db: Db, sessionId: string): SheetSession | null;
  ```

  Every field is JSON-serialisable, because this crosses the server/client
  boundary as a prop. `merchantName` is deliberately absent — it comes from `env`
  at each call site, so this module never imports `env`.

- [ ] **Step 1: Write the failing test**

Create `apps/merchant/src/lib/checkout-session.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { loadCheckoutSession } from "./checkout-session.js";

let dir: string;
let db: Db;

const NOW = 1_700_000_000_000;

function insertOrder(id: string, totalCents: number): void {
  db.insert(orders)
    .values({
      id,
      totalCents,
      currency: "EUR",
      customerName: "Ada Lovelace",
      customerEmail: "ada@example.test",
      status: "pending",
      createdAt: NOW,
    })
    .run();
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-cs-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadCheckoutSession", () => {
  it("returns the sheet's props for a live request_uri session", () => {
    insertOrder("ord_1", 1747);
    db.insert(paymentSessions)
      .values({
        id: "sess_1",
        orderId: "ord_1",
        state: "pending",
        openid4vpUri: "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F1",
        transport: "request_uri",
        namedQueryRef: "dpc",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_1")).toEqual({
      sessionId: "sess_1",
      orderId: "ord_1",
      amountCents: 1747,
      openid4vpUri: "openid4vp://?request_uri=https%3A%2F%2Ffoundry.test%2Fr%2F1",
      transport: "request_uri",
      ageRequested: false,
      dcApiRequest: null,
      initialState: "pending",
    });
  });

  it("reports ageRequested from the recorded named query", () => {
    insertOrder("ord_2", 899);
    db.insert(paymentSessions)
      .values({
        id: "sess_2",
        orderId: "ord_2",
        state: "pending",
        openid4vpUri: "openid4vp://x",
        transport: "request_uri",
        namedQueryRef: "dpc_av",
        createdAt: NOW,
      })
      .run();

    expect(loadCheckoutSession(db, "sess_2")?.ageRequested).toBe(true);
  });

  it("parses the stored dc_api request object and has no uri", () => {
    insertOrder("ord_3", 500);
    db.insert(paymentSessions)
      .values({
        id: "sess_3",
        orderId: "ord_3",
        state: "pending",
        transport: "dc_api",
        namedQueryRef: "dpc",
        dcApiRequestJson: JSON.stringify({ response_mode: "dc_api.jwt" }),
        createdAt: NOW,
      })
      .run();

    const loaded = loadCheckoutSession(db, "sess_3");
    expect(loaded?.transport).toBe("dc_api");
    expect(loaded?.openid4vpUri).toBe("");
    expect(loaded?.dcApiRequest).toEqual({ response_mode: "dc_api.jwt" });
  });

  it("carries a terminal state and its failure reason", () => {
    insertOrder("ord_4", 300);
    db.insert(paymentSessions)
      .values({
        id: "sess_4",
        orderId: "ord_4",
        state: "failed",
        failureReason: "insufficient_funds",
        transport: "request_uri",
        namedQueryRef: "dpc",
        createdAt: NOW,
      })
      .run();

    const loaded = loadCheckoutSession(db, "sess_4");
    expect(loaded?.initialState).toBe("failed");
    expect(loaded?.initialFailureReason).toBe("insufficient_funds");
  });

  it("returns null for an unknown session id", () => {
    expect(loadCheckoutSession(db, "sess_nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/checkout-session.test.ts
```

Expected: FAIL — `Failed to resolve import "./checkout-session.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/merchant/src/lib/checkout-session.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";

/**
 * The payment sheet's props, as one serialisable object.
 *
 * This crosses the server/client boundary as a prop, so it holds only JSON —
 * no functions, no Date. `merchantName` is deliberately absent: it comes from
 * `env` at each call site, which keeps this module out of env validation and
 * therefore trivially testable.
 */
export interface SheetSession {
  sessionId: string;
  orderId: string;
  amountCents: number;
  /** Empty string under dc_api — there is no URI to navigate to. */
  openid4vpUri: string;
  transport: "request_uri" | "dc_api";
  /** True when this session presents the `dpc_av` named query. */
  ageRequested: boolean;
  dcApiRequest: unknown;
  initialState: string;
  initialFailureReason?: string;
}

/**
 * Re-opens the sheet from `/checkout?session=<id>`.
 *
 * Needed because a coarse-pointer wallet handover navigates the tab away with
 * `window.location.href`; when the wallet returns the shopper, `/checkout`
 * re-mounts with no client state at all. The session id in the URL is the only
 * thing that survives, so it is what the sheet is rebuilt from.
 *
 * Returns null rather than throwing for an unknown id: a stale or hand-edited
 * `?session=` should render the ordinary checkout form, not an error page.
 */
export function loadCheckoutSession(db: Db, sessionId: string): SheetSession | null {
  const session = db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.id, sessionId))
    .get();
  if (!session) return null;

  const order = db
    .select()
    .from(orders)
    .where(eq(orders.id, session.orderId))
    .get();
  if (!order) return null;

  return {
    sessionId: session.id,
    orderId: order.id,
    amountCents: order.totalCents,
    openid4vpUri: session.openid4vpUri ?? session.requestUri ?? "",
    transport: session.transport,
    ageRequested: session.namedQueryRef === "dpc_av",
    dcApiRequest: session.dcApiRequestJson
      ? JSON.parse(session.dcApiRequestJson)
      : null,
    initialState: session.state,
    ...(session.failureReason
      ? { initialFailureReason: session.failureReason }
      : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/checkout-session.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the gate**

```bash
pnpm check
```

Expected: PASS, **290 tests** (285 + 5). Report the measured number.

- [ ] **Step 6: Commit**

```bash
git add apps/merchant/src/lib/checkout-session.ts \
  apps/merchant/src/lib/checkout-session.test.ts
git commit -m "feat(merchant): rebuild the payment sheet from a session id in the URL"
```

---

### Task 7: The sheet's typography and CSS

Spec §3.1–§3.3 and every defect in §6. This task replaces the existing
`.eudipay-*` block wholesale. It ships a visibly different sheet with the old
markup still driving it, which is deliberate: the CSS and the markup are reviewed
separately so a spacing regression can be attributed.

**Files:**

- Modify: `apps/merchant/src/app/layout.tsx`
- Modify: `apps/merchant/src/app/globals.css`

**Interfaces:**

- Consumes: nothing.
- Produces: the class names Task 9's markup uses —
  `.eudipay-overlay`, `.eudipay-sheet`, `.eudipay-mark`, `.eudipay-rule`,
  `.eudipay-eyebrow` (+ `.is-alarm`), `.eudipay-amount` (+ `.is-compact`),
  `.eudipay-strip`, `.eudipay-cell`, `.eudipay-cell-k`, `.eudipay-cell-v`,
  `.eudipay-pill`, `.eudipay-qr-frame`, `.eudipay-headline`, `.eudipay-body`,
  `.eudipay-checks`, `.eudipay-actions`, `.eudipay-button`,
  `.eudipay-button-primary`, `.eudipay-button-secondary`, `.eudipay-cancel`,
  `.eudipay-star`, `.eudipay-star-lit`. Plus the `--font-eudipay` theme token.

- [ ] **Step 1: Load Archivo**

In `apps/merchant/src/app/layout.tsx`, add `Archivo` to the `next/font/google`
import and declare it beside the other faces:

```tsx
import { Archivo, Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
```

```tsx
/*
 * Archivo carries the EudiPay payment sheet, and only the sheet. The handover
 * only reads as a handover if the typography changes hands, so the shop's
 * Bricolage never appears on it and Archivo never appears in the shop.
 *
 * The `wdth` axis is the point: the amount is set at wdth 125 so the number
 * reads as signage on an official instrument rather than as UI text.
 *
 * NB: same naming rule as `display` below — the variable must NOT be called
 * --font-eudipay, because @theme defines that on :root, the same element
 * next/font writes to, and a self-referential token resolves to nothing.
 */
const eudipay = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-eudipay-face",
  display: "swap",
});
```

Add `${eudipay.variable}` to the `<html>` className list.

- [ ] **Step 2: Verify the font actually builds**

```bash
pnpm --filter @demo/merchant build
```

Expected: PASS. `next/font` hard-fails at build time on an axis a family does not
publish. **If it fails on `axes: ["wdth"]`**, remove the `axes` line entirely and
drop every `font-variation-settings: "wdth" …` declaration from Step 4, replacing
the amount's width effect with `letter-spacing: -0.045em` alone. Record which
branch you took in the commit message.

- [ ] **Step 3: Add the theme token**

In `apps/merchant/src/app/globals.css`, inside the existing `@theme` block, add
after `--font-mono`:

```css
  --font-eudipay: var(--font-eudipay-face), var(--font-body), system-ui, sans-serif;
```

- [ ] **Step 4: Replace the whole payment-sheet section**

Delete everything in `globals.css` from the
`/* ---- EudiPay payment sheet ---- */` banner comment down to (but not
including) the `/* ---- motion ---- */` banner, plus the
`@media (max-width: 480px)` block that belongs to it, and put this in its place:

```css
/* -------------------------------------------------- EudiPay payment sheet ---- */

/*
 * Spec §9.4/§9.5 fix the brand colours here — #004DD7, #FFCC00, #FFEFB4 are not
 * Larder's to change — but the 2026-08-19 design owns everything else: layout,
 * type, elevation, and the state choreography.
 *
 * Two deliberate departures from this file's own conventions, both documented so
 * they are not "cleaned up":
 *
 * 1. This sheet HAS a box-shadow. The no-shadow rule at the top of this file is
 *    a rule about the *shop's* surfaces, which separate by hairline and ground
 *    colour so the photography owns all the depth. The sheet is not one of the
 *    shop's surfaces — it is a third party's instrument lifted off the page, and
 *    it has to say so. The original spec asked for elevation here and it was
 *    silently dropped, which is a large part of why the sheet read as cheap.
 *
 * 2. This sheet owns its own padding and vertical rhythm. The convention that
 *    component classes declare appearance only exists so the shop's markup can
 *    tune spacing per instance. The sheet has exactly one instance, its rhythm
 *    is part of the design, and splitting it between a stylesheet and a scatter
 *    of mt-* utilities on inline-level elements is precisely what produced the
 *    reported spacing defects.
 */

.eudipay-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  /* A tall sheet must scroll. `min-height: 100dvh` on a fixed, inset-0 element
   * was redundant and prevented exactly that. */
  overflow-y: auto;
  padding: 1rem;
  /* Light enough that the checkout behind stays legible — that is the whole
   * point of opening over the page rather than on a blank route. */
  background: rgb(11 18 32 / 0.28);
  backdrop-filter: blur(2px);
  animation: eudipay-fade-in 0.24s ease both;
  font-family: var(--font-sans);
}

.eudipay-sheet {
  width: 100%;
  max-width: 25rem;
  /* The instrument's ground. Already a brand shade — it is the stripe in
   * EudiPayLogo — rather than a new invention. */
  background: #003ba8;
  color: #ffffff;
  border-radius: 20px;
  padding: 24px 26px 20px;
  text-align: center;
  box-shadow: 0 26px 60px -22px rgb(0 20 70 / 0.55);
  animation: eudipay-slide-up 0.32s cubic-bezier(0.2, 0.8, 0.3, 1) both;
}

.eudipay-mark {
  font-family: var(--font-eudipay);
  font-variation-settings: "wdth" 108;
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.02em;
  margin-top: 4px;
}

/* Full-bleed: the sheet's padding is declared here, so the negative margin can
 * reference it instead of guessing a utility class's value. */
.eudipay-rule {
  height: 1px;
  background: rgb(255 204 0 / 0.42);
  margin: 14px -26px 16px;
}

.eudipay-eyebrow {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: #ffcc00;
}

.eudipay-eyebrow.is-alarm {
  color: #ffb3b3;
}

.eudipay-amount {
  font-family: var(--font-eudipay);
  font-variation-settings: "wdth" 125;
  font-weight: 700;
  font-size: 3.25rem;
  line-height: 0.92;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  margin-top: 7px;
}

/* The QR is the thing to act on when there is one, so the amount steps down. */
.eudipay-amount.is-compact {
  font-size: 2.25rem;
}

.eudipay-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: rgb(255 255 255 / 0.16);
  border-radius: 6px;
  overflow: hidden;
  margin-top: 16px;
}

.eudipay-cell {
  background: #003ba8;
  padding: 8px 10px;
  text-align: left;
}

.eudipay-cell-k {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(255 204 0 / 0.85);
}

.eudipay-cell-v {
  font-family: var(--font-mono);
  font-size: 0.78125rem;
  font-weight: 500;
  margin-top: 3px;
  word-break: break-all;
}

.eudipay-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: #ffefb4;
  color: #5a4400;
  border-radius: 9999px;
  padding: 5px 12px;
  font-size: 0.75rem;
  font-weight: 600;
  margin-top: 16px;
}

/* The window in the instrument. The QR must stay #004DD7 on #FFFFFF — scanner
 * contrast is not negotiable — so this white inset is deliberate, not a seam. */
.eudipay-qr-frame {
  display: inline-block;
  background: #ffffff;
  border-radius: 12px;
  padding: 12px;
  margin-top: 14px;
}

.eudipay-headline {
  font-family: var(--font-eudipay);
  font-variation-settings: "wdth" 104;
  font-weight: 700;
  font-size: 1.125rem;
  margin-top: 14px;
}

.eudipay-body {
  font-size: 0.8125rem;
  line-height: 1.45;
  color: rgb(255 255 255 / 0.72);
  margin-top: 12px;
}

.eudipay-checks {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(255 255 255 / 0.62);
  margin-top: 12px;
  word-break: break-all;
}

.eudipay-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 20px;
}

/*
 * Block-level and full-width, with its own horizontal padding. The old rule was
 * inline-flex with no padding-inline at all, so every label ran to its own edges
 * and vertical spacing came from line boxes rather than from block flow.
 */
.eudipay-button {
  display: block;
  width: 100%;
  padding: 13px 20px;
  border: 0;
  border-radius: 10px;
  font-family: inherit;
  font-size: 0.9375rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background-color 130ms ease,
    color 130ms ease;
}

.eudipay-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.eudipay-button-primary {
  background: #ffffff;
  color: #004dd7;
}

.eudipay-button-primary:hover:not(:disabled) {
  background: #e8eeff;
}

.eudipay-button-secondary {
  background: rgb(255 255 255 / 0.14);
  color: #ffffff;
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.3);
}

.eudipay-button-secondary:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.22);
}

.eudipay-cancel {
  display: inline-block;
  background: none;
  border: 0;
  margin-top: 14px;
  font-family: inherit;
  font-size: 0.75rem;
  color: rgb(255 255 255 / 0.7);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.eudipay-cancel:hover {
  color: #ffffff;
}

/* ------------------------------------------------------ the status ring ---- */

.eudipay-star {
  fill: rgb(255 204 0 / 0.22);
  transition: fill 220ms ease;
}

.eudipay-star-lit {
  fill: #ffcc00;
}

/* Mobile: the sheet slides up from the bottom edge, as a payment sheet should. */
@media (max-width: 480px) {
  .eudipay-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .eudipay-sheet {
    max-width: none;
    border-radius: 20px 20px 0 0;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
  }
}
```

- [ ] **Step 5: Fix the focus ring and the reduced-motion block**

At the end of `globals.css`, replace:

```css
.eudipay-card :where(a, button, summary):focus-visible {
  outline-color: #004DD7;
}
```

with:

```css
/* #004DD7 on the #003BA8 field is very nearly invisible; the star yellow is the
 * only value on this surface with real contrast against it. */
.eudipay-sheet :where(a, button, summary):focus-visible {
  outline-color: #ffcc00;
}
```

and in the `@media (prefers-reduced-motion: reduce)` block, replace the whole
rule list with:

```css
@media (prefers-reduced-motion: reduce) {
  .shelf-item,
  .eudipay-overlay,
  .eudipay-sheet {
    animation: none;
  }

  /* The ring's own motion is suppressed in the component, which pins it to
   * SheetView.litStars instead of cycling. Nothing here spins. */
  .eudipay-star {
    transition: none;
  }
}
```

Also delete the now-unused `@keyframes eudipay-spin`.

- [ ] **Step 6: Amend the file's opening no-shadow claim**

Near the top of `globals.css`, replace:

```
 * There are no box-shadows in this file, on purpose. Surfaces separate by
 * hairline border and by ground colour, which keeps the photography — the only
 * thing on the page with real depth — as the sole source of dimension.
```

with:

```
 * The shop's surfaces carry no box-shadow, on purpose. They separate by hairline
 * border and by ground colour, which keeps the photography — the only thing on
 * the page with real depth — as the sole source of dimension. The one exception
 * is the EudiPay sheet at the bottom of this file, which is not one of the
 * shop's surfaces; see the reasoning there.
```

- [ ] **Step 7: Confirm it compiles and the old classes are gone**

```bash
pnpm --filter @demo/merchant build
grep -rn "eudipay-card\|eudipay-spinner\|eudipay-badge\|eudipay-headline" apps/merchant/src
```

The build will FAIL or the grep will report hits in `PaymentScreen.tsx`, which
still uses the old class names — that is expected and is Task 9's job. Do not fix
it here. If the build fails **only** on unknown classes in `PaymentScreen.tsx`,
proceed; if it fails on the font or on CSS syntax, fix that before committing.

- [ ] **Step 8: Commit**

```bash
git add apps/merchant/src/app/layout.tsx apps/merchant/src/app/globals.css
git commit -m "feat(merchant): restyle the EudiPay sheet as a blue instrument

The sheet gains its own padding and rhythm, real elevation, a full-width button
with horizontal padding, and a visible focus ring. Both departures from this
file's conventions are documented in place. PaymentScreen still references the
old class names and is rebuilt in the next commit."
```

---

### Task 8: The twelve-star status ring

Spec §3.4 (D5). The twelve stars leave `EudiPayLogo` and become a larger element
that encircles a card glyph and reports state. The ring's motion lives in the
component, not in CSS: accumulating twelve stars on a 400ms tick is exact in JS
and a fight in pure CSS.

`EudiPayLogo` is **retired rather than rewritten**, in Task 9. Measured before
planning: `PaymentScreen.tsx` is its only importer in the whole app, and Task 9
stops importing it — so a rewritten mark would be dead code that `knip` would
flag. `EudiPayRing` draws the card glyph itself, at the centre of the ring, which
is the only place the sheet needs it.

**Files:**

- Create: `apps/merchant/src/lib/useReducedMotion.ts`
- Create: `apps/merchant/src/components/EudiPayRing.tsx`

**Interfaces:**

- Consumes: `ringPoints`, `starPath` from `@demo/ui` (Task 1); `SheetGlyph` from
  `lib/sheet-state.js` (Task 4).
- Produces:

  ```ts
  // lib/useReducedMotion.ts
  export function useReducedMotion(): boolean;
  // components/EudiPayRing.tsx
  export interface EudiPayRingProps {
    litStars: number;
    animate: boolean;
    glyph: SheetGlyph;
    className?: string;
  }
  export function EudiPayRing(props: EudiPayRingProps): JSX.Element;
  ```

  Nothing consumes this task's output yet; Task 9 is its only consumer.

- [ ] **Step 1: Read the hook this one mirrors**

```bash
cat packages/ui/src/useIsTouch.ts
```

Mirror its structure exactly — `"use client"`, `useState(false)`, a `useEffect`
that reads `matchMedia`, subscribes to `change`, and unsubscribes on cleanup.
Defaulting to `false` during SSR is what keeps the server and first client render
in agreement.

- [ ] **Step 2: Write the hook**

Create `apps/merchant/src/lib/useReducedMotion.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

/**
 * True when the user has asked for reduced motion. Kept in the merchant app
 * rather than in @demo/ui because only this app's payment sheet consults it, and
 * the bank has no equivalent motion to suppress.
 *
 * False during SSR so the server and the first client render agree; the ring
 * therefore starts static and begins cycling on the first effect, which is the
 * safe direction.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
```

- [ ] **Step 3: Write the ring**

Create `apps/merchant/src/components/EudiPayRing.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ringPoints, starPath } from "@demo/ui";
import { useReducedMotion } from "@/lib/useReducedMotion.js";
import type { SheetGlyph } from "@/lib/sheet-state.js";

/** One 400ms step per star; twelve stars, then it starts over. */
const STEP_MS = 400;
const STARS = 12;

export interface EudiPayRingProps {
  /** What to show when the ring is static. 0..12. */
  litStars: number;
  /** Cycle 1 -> 12 instead. Ignored under prefers-reduced-motion. */
  animate: boolean;
  glyph: SheetGlyph;
  className?: string;
}

/**
 * The payment sheet's status indicator, and its one bold move.
 *
 * The twelve stars used to live inside EudiPayLogo alongside the card. They are
 * out here now because this is the only indicator that keeps its meaning across
 * every state the sheet has — a spinner cannot express "eleven of twelve, the
 * last one belongs to the bank", and it cannot express "declined" at all. It is
 * also the brand's own iconography rather than borrowed UI furniture.
 *
 * The cycle is driven in JS on purpose. Accumulating stars one per tick and
 * restarting is exact here; in CSS it needs per-star negative delays and a
 * fill-mode that lights everything permanently after the first pass.
 *
 * aria-hidden: this is decoration. Every state also carries its pill or headline
 * as text, and the sheet announces those through a role="status" region.
 */
export function EudiPayRing({ litStars, animate, glyph, className }: EudiPayRingProps) {
  const reduced = useReducedMotion();
  const cycling = animate && !reduced;
  const [tick, setTick] = useState(1);

  useEffect(() => {
    if (!cycling) return;
    setTick(1);
    const timer = setInterval(
      () => setTick((current) => (current % STARS) + 1),
      STEP_MS,
    );
    return () => clearInterval(timer);
  }, [cycling]);

  const lit = cycling ? tick : litStars;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {ringPoints(50, 50, 40).map((point, index) => (
        <path
          key={index}
          d={starPath(point.x, point.y, 5.2)}
          className={index < lit ? "eudipay-star eudipay-star-lit" : "eudipay-star"}
        />
      ))}
      <RingGlyph glyph={glyph} />
    </svg>
  );
}

/**
 * The mark at the centre of the ring, on a white card so it reads as the
 * instrument's own chip rather than as a hole in the field.
 */
function RingGlyph({ glyph }: { glyph: SheetGlyph }) {
  return (
    <>
      <rect x="27" y="35" width="46" height="30" rx="5.5" fill="#ffffff" />
      {glyph === "card" ? (
        <>
          <rect x="27" y="42" width="46" height="6" fill="#004dd7" />
          <circle cx="64" cy="58" r="4.2" fill="#ffcc00" />
        </>
      ) : glyph === "check" ? (
        <path
          d="M39 50.5 46 57.5 61 42.5"
          stroke="#004dd7"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      ) : (
        <>
          <rect x="47.5" y="41" width="5" height="11" rx="2.5" fill="#e05252" />
          <circle cx="50" cy="58" r="2.9" fill="#e05252" />
        </>
      )}
    </>
  );
}
```

Note the alert glyph uses `#e05252`, not the `#FFB3B3` of spec §3.1: `#FFB3B3` is
specified as ink **on the blue field**, and this glyph sits on the white card
where that tint would be unreadable. The eyebrow keeps `#FFB3B3`.

- [ ] **Step 4: Leave `EudiPayLogo.tsx` alone**

Do **not** edit or delete it in this task — `PaymentScreen.tsx` still renders it,
so deleting it here breaks the build. Task 9 drops the import and deletes the file
in one commit. Confirm the importer set is still what the plan assumes:

```bash
grep -rn "EudiPayLogo" apps/merchant/src
```

Expected: `components/EudiPayLogo.tsx` itself plus exactly two lines in
`components/PaymentScreen.tsx`. If any other file appears, stop and say so — the
deletion planned for Task 9 would then be wrong.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @demo/merchant typecheck
```

Expected: PASS. `EudiPayRing` has no importer yet, which is fine —
`noUnusedLocals` flags unused locals inside a module, not an exported component
nobody imports.

- [ ] **Step 6: Verify the gate is still green**

```bash
pnpm check
```

Expected: PASS, **290 tests** — unchanged from Task 6, since `.tsx` is not
covered by any vitest project. Report the measured number.

- [ ] **Step 7: Commit**

```bash
git add apps/merchant/src/lib/useReducedMotion.ts \
  apps/merchant/src/components/EudiPayRing.tsx
git commit -m "feat(merchant): promote the EU stars to the sheet's status ring

The ring is the only indicator that keeps its meaning in all six sheet states,
which a spinner cannot. Motion is driven in the component so prefers-reduced-
motion pins it to a static count rather than slowing a spin. Not yet rendered —
PaymentScreen still draws the old spinner."
```

---

### Task 9: `PaymentScreen` becomes a renderer

Spec §4, §6 and §9. Every `if` in the JSX collapses into `selectSheetView`, and
the component gains the modal behaviour §5.6 requires: a focus trap, initial
focus, focus restoration, `Escape` → Cancel, and a `role="status"` region so the
ring is never the only signal.

**Files:**

- Modify: `apps/merchant/src/components/PaymentScreen.tsx` (full rewrite)

**Interfaces:**

- Consumes: `selectSheetView` (Task 4), `EudiPayRing` (Task 8), `.eudipay-*`
  classes (Task 7), `useCart` (existing),
  `useStatusPoll` / `useIsTouch` / `QrCanvas` / DC API helpers (existing
  `@demo/ui`).
- Produces:

  ```ts
  export interface PaymentScreenProps {
    sessionId: string;
    orderId: string;
    amountCents: number;
    merchantName: string;
    openid4vpUri: string;
    transport: "request_uri" | "dc_api";
    ageRequested: boolean;
    dcApiRequest: unknown;
    initialState: string;
    initialFailureReason?: string;
    /** Present only when the sheet is a modal on /checkout. */
    onClose?: () => void;
  }
  ```

  `onClose` is a function, so it can only be passed from another client
  component. `/pay/[sessionId]` is a server component and omits it, which is
  exactly the difference between the modal and the standalone route.

- [ ] **Step 1: Read the file you are replacing**

```bash
cd apps/merchant && cat src/components/PaymentScreen.tsx
```

Keep its polling shape (`fetchOnce`, `isTerminal`, `useStatusPoll`), its
`failedChecks` extraction, its touch-redirect effect, and its `payViaDcApi`
ordering — **no `await` before `invokeDcGet`**. Everything else is replaced.

- [ ] **Step 2: Write the replacement**

Replace `apps/merchant/src/components/PaymentScreen.tsx` entirely:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DC_API_PRESENTATION_PROTOCOL,
  QrCanvas,
  invokeDcGet,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  useIsTouch,
  useStatusPoll,
} from "@demo/ui";
import { formatEuroCents } from "@/lib/format.js";
import { selectSheetView, type DcError } from "@/lib/sheet-state.js";
import { useCart } from "@/lib/useCart.js";
// NB: EudiPayLogo is deliberately NOT imported. The ring draws its own card
// glyph at the centre, so importing the standalone mark here would both put two
// cards on one sheet and trip `noUnusedLocals`.
import { EudiPayRing } from "./EudiPayRing.js";

/** EudiPay brand blue — also the QR's dark modules (spec §9.5). */
const BRAND_BLUE = "#004DD7";

export interface PaymentScreenProps {
  sessionId: string;
  orderId: string;
  amountCents: number;
  merchantName: string;
  openid4vpUri: string;
  transport: "request_uri" | "dc_api";
  /** True when this session presents `dpc_av`; adds one clause to the copy. */
  ageRequested: boolean;
  dcApiRequest: unknown;
  /** A session that was already terminal when the page rendered. */
  initialState: string;
  initialFailureReason?: string;
  /**
   * Close the sheet and return to the page underneath. Present only when the
   * sheet is a modal on /checkout — /pay/[sessionId] is a server component and
   * cannot pass a function, so there it falls back to navigating home.
   */
  onClose?: () => void;
}

interface SessionStatus {
  state: string;
  failureReason?: string;
  failedChecks: string[];
}

export function PaymentScreen({
  sessionId,
  orderId,
  amountCents,
  merchantName,
  openid4vpUri,
  transport,
  ageRequested,
  dcApiRequest,
  initialState,
  initialFailureReason,
  onClose,
}: PaymentScreenProps) {
  const router = useRouter();
  const isTouch = useIsTouch();
  const { clear } = useCart();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusTo = useRef<HTMLElement | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [dcError, setDcError] = useState<DcError>(null);
  const [dcBusy, setDcBusy] = useState(false);

  const terminalAtRender = initialState === "completed" || initialState === "failed";

  const fetchOnce = useCallback<() => Promise<SessionStatus>>(async () => {
    const response = await fetch(`/api/payment-sessions/${sessionId}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = (await response.json()) as {
      state?: unknown;
      failureReason?: unknown;
      checks?: unknown;
    };
    return {
      state: typeof body.state === "string" ? body.state : "pending",
      failureReason:
        typeof body.failureReason === "string" ? body.failureReason : undefined,
      // Spec §6.3 requires a failed verification to name the checks that
      // failed, so they are carried through rather than discarded.
      failedChecks: Array.isArray(body.checks)
        ? body.checks.flatMap((entry) =>
            typeof entry === "object" &&
            entry !== null &&
            (entry as { passed?: unknown }).passed === false &&
            typeof (entry as { check?: unknown }).check === "string"
              ? [(entry as { check: string }).check]
              : [],
          )
        : [],
    };
  }, [sessionId]);

  const isTerminal = useCallback(
    (value: SessionStatus) => value.state === "completed" || value.state === "failed",
    [],
  );

  const { value, outcome } = useStatusPoll<SessionStatus>({
    fetchOnce,
    isTerminal,
    enabled: !terminalAtRender,
  });

  const state = value?.state ?? initialState;
  const failureReason = value?.failureReason ?? initialFailureReason;
  const failedChecks = value?.failedChecks ?? [];

  const view = selectSheetView({
    state,
    transport,
    ageRequested,
    redirecting,
    dcBusy,
    dcError,
    // PollOutcome's union is "terminal" | "timeout" | "failed" | "aborted".
    // Only two of those change what the sheet shows: `terminal` is already
    // expressed by `state` becoming completed/failed, and `aborted` only fires
    // on unmount, when nothing renders anyway.
    pollStatus:
      outcome?.status === "failed"
        ? "failed"
        : outcome?.status === "timeout"
          ? "timeout"
          : terminalAtRender
            ? null
            : "running",
    failureReason,
  });

  // On a touch device the wallet lives on this same phone, so follow the deep
  // link rather than rendering a QR nobody can scan (spec §9.5). Under dc_api
  // there is no URI to navigate to, and the gesture requirement forbids an
  // on-mount action anyway.
  useEffect(() => {
    if (transport !== "request_uri") return;
    if (!isTouch || terminalAtRender || redirecting) return;
    setRedirecting(true);
    window.location.href = openid4vpUri;
  }, [transport, isTouch, terminalAtRender, redirecting, openid4vpUri]);

  // The cart is cleared HERE, not when the form was submitted: the basket is
  // the content this sheet sits over, and a declined payment must leave it
  // intact so "Back to the shop" is recoverable.
  useEffect(() => {
    if (state !== "completed") return;
    clear();
    const timer = setTimeout(() => router.replace(`/success?orderId=${orderId}`), 1500);
    return () => clearTimeout(timer);
  }, [state, router, orderId, clear]);

  // Modal behaviour (spec §5.6): real focusable content now sits behind this
  // dialog, so focus must be captured, moved in, and handed back.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    return () => restoreFocusTo.current?.focus();
  }, []);

  const cancel = useCallback(async () => {
    await fetch(`/api/payment-sessions/${sessionId}/cancel`, { method: "POST" });
    if (onClose) onClose();
    else router.replace("/");
  }, [sessionId, onClose, router]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && view.showCancel) {
      event.preventDefault();
      void cancel();
      return;
    }
    if (event.key !== "Tab") return;
    // A minimal trap: cycle within the sheet rather than escaping to the inert
    // page behind it.
    const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** A fresh presentation for the same still-pending order (spec §6.3). */
  async function startFreshSession(dcApi: boolean) {
    setRetryError(null);
    try {
      const response = await fetch("/api/payment-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, dcApi }),
      });
      if (!response.ok) {
        setRetryError("Could not start a new payment. Please start over from the shop.");
        return;
      }
      const body = (await response.json()) as { sessionId: string };
      router.replace(`/checkout?session=${body.sessionId}`);
    } catch {
      setRetryError("Could not reach the server. Please try again.");
    }
  }

  // No `await` may execute before invokeDcGet — Chrome consumes the click's
  // transient activation otherwise. dcApiRequest is already a prop.
  async function payViaDcApi() {
    setDcBusy(true);
    try {
      const data = await invokeDcGet(
        prepareDcApiRequest(dcApiRequest, DC_API_PRESENTATION_PROTOCOL),
      );
      await fetch(`/api/payment-sessions/${sessionId}/dc-api-response`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ response: data.response }),
      });
      // The poll already running picks up the verdict on its next tick.
    } catch (err) {
      setDcError(isDcApiNotSupportedError(err) ? "unsupported" : "failed");
    } finally {
      setDcBusy(false);
    }
  }

  function onPrimaryAction() {
    if (view.primaryAction === "approve") void payViaDcApi();
    // A dc_api session cannot be re-rendered as a QR: it is bound to
    // response_mode dc_api.jwt with an inlined request object. Recovery is a
    // fresh request_uri session for the same still-pending order.
    else if (view.primaryAction === "show-qr") void startFreshSession(false);
    // A dc_api session existing at all proves detection said yes on this
    // browser, so a retry keeps the preferred transport (spec D1).
    else if (view.primaryAction === "retry") void startFreshSession(transport === "dc_api");
  }

  const primaryLabel =
    view.primaryAction === "approve"
      ? dcBusy
        ? "Opening your wallet…"
        : "Approve in your wallet"
      : view.primaryAction === "show-qr"
        ? "Show QR code"
        : "Try again";

  return (
    <div className="eudipay-overlay">
      <div
        ref={sheetRef}
        className="eudipay-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="EudiPay payment"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <EudiPayRing
          litStars={view.litStars}
          animate={view.animate}
          glyph={view.glyph}
          className="mx-auto block h-28 w-28"
        />
        <p className="eudipay-mark">EudiPay</p>

        <div className="eudipay-rule" />

        <p className={view.phase === "declined" ? "eudipay-eyebrow is-alarm" : "eudipay-eyebrow"}>
          {view.eyebrow}
        </p>
        {/* The amount is the largest thing on the sheet in every state: the
            shopper's question is always "what happened to my €17.47". */}
        <p className={view.showQr ? "eudipay-amount is-compact" : "eudipay-amount"}>
          {formatEuroCents(amountCents)}
        </p>

        <div className="eudipay-strip">
          <div className="eudipay-cell">
            <p className="eudipay-cell-k">Payee</p>
            <p className="eudipay-cell-v">{merchantName}</p>
          </div>
          <div className="eudipay-cell">
            <p className="eudipay-cell-k">Order</p>
            <p className="eudipay-cell-v">{orderId}</p>
          </div>
        </div>

        {/* The ring is aria-hidden, so this region is how state reaches a
            screen reader. */}
        <div role="status">
          {view.pill ? <p className="eudipay-pill">{view.pill}</p> : null}
          {view.headline ? <p className="eudipay-headline">{view.headline}</p> : null}
        </div>

        {view.showQr ? (
          <div className="eudipay-qr-frame">
            <QrCanvas
              value={openid4vpUri}
              size={200}
              darkColor={BRAND_BLUE}
              ariaLabel="QR code for the payment request"
            />
          </div>
        ) : null}

        <p className="eudipay-body">{view.body}</p>

        {failedChecks.length > 0 ? (
          <p className="eudipay-checks">failed: {failedChecks.join(", ")}</p>
        ) : null}

        {retryError ? (
          <p role="alert" className="eudipay-body">
            {retryError}
          </p>
        ) : null}

        {view.primaryAction || view.showBackToShop ? (
          <div className="eudipay-actions">
            {view.primaryAction ? (
              <button
                type="button"
                onClick={onPrimaryAction}
                disabled={dcBusy}
                className="eudipay-button eudipay-button-primary"
              >
                {primaryLabel}
              </button>
            ) : null}
            {view.showBackToShop ? (
              <button
                type="button"
                onClick={() => router.replace("/")}
                className="eudipay-button eudipay-button-secondary"
              >
                Back to the shop
              </button>
            ) : null}
          </div>
        ) : null}

        {view.showCancel ? (
          <button type="button" onClick={() => void cancel()} className="eudipay-cancel">
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Fix the one caller that now type-errors**

`apps/merchant/src/app/pay/[sessionId]/page.tsx` does not yet pass
`ageRequested`. Add it from the session row:

```tsx
      ageRequested={session.namedQueryRef === "dpc_av"}
```

- [ ] **Step 4: Delete the two components this replaced**

`PaymentScreen.tsx` was the **only** importer of both `EudiPayLogo.tsx` and the
merchant's `StatusMark.tsx` — measured before planning — and the rewrite above
imports neither. Both are now dead code. Confirm, then delete:

```bash
grep -rn "EudiPayLogo\|StatusMark\|CheckMark\|AlertMark" apps/merchant/src
```

Expected: hits **only** inside those two component files themselves. If any other
file appears, do not delete — report it instead. Otherwise:

```bash
git rm apps/merchant/src/components/EudiPayLogo.tsx \
  apps/merchant/src/components/StatusMark.tsx
```

The **bank** app has its own separate `StatusMark.tsx`. Do not touch it.

- [ ] **Step 5: Typecheck and build**

```bash
pnpm --filter @demo/merchant typecheck
pnpm --filter @demo/merchant build
```

Expected: both PASS.

- [ ] **Step 6: Verify the gate**

```bash
pnpm check
```

Expected: PASS, **290 tests** — unchanged. Report the measured number.

- [ ] **Step 7: Verify in a real browser**

Start a production server, then with `tools/cdp/cdp.mjs`:

- Go through checkout to `/pay/<id>`. The sheet renders on the blue field with a
  twelve-star ring, the amount as the largest element, and a payee/order strip.
- Every button has visible horizontal padding and is full-width.
- Tab cycles inside the sheet and does not reach the page behind it.
- `Escape` cancels while Cancel is offered.
- Force `state = 'settling'` in the database and reload: eleven stars, no Cancel.
- Force `state = 'completed'`: twelve stars, check glyph, "Payment approved",
  eyebrow reads "Paid", then it advances to `/success`.
- Force `state = 'failed'` with `failure_reason = 'insufficient_funds'`: empty
  ring, alert glyph, "Payment declined", Try again + Back to the shop.

Use a scratch `.ts` file plus `pnpm exec tsx --env-file-if-exists=.env.local` to
force those rows — see `AGENTS.md` for why `node --experimental-strip-types` and
`tsx -e` both fail here.

- [ ] **Step 8: Commit**

```bash
git add -A apps/merchant/src/components \
  "apps/merchant/src/app/pay/[sessionId]/page.tsx"
git commit -m "feat(merchant): render the payment sheet from SheetView

All branching moves to selectSheetView, so the sheet has one layout rather than
five divergent ones. Adds the focus trap, Escape-to-cancel, focus restoration and
the role=status region the overlay needs. EudiPayLogo and the merchant's
StatusMark are deleted: this was their only importer, and the ring's centre glyph
now does both jobs.

Verified in headless Chrome against a production server for waiting, settling,
approved and declined — the last three by forcing the session row. The wallet leg
remains unexercisable here."
```

---

### Task 10: The sheet opens over the checkout (D1)

Spec §5.1, §5.3 and §5.6. `CheckoutForm` stops navigating; a new `CheckoutPanel`
owns both the form and the sheet, mirrors the session into `?session=`, and marks
the page behind the sheet `inert`.

**Files:**

- Create: `apps/merchant/src/components/CheckoutPanel.tsx`
- Modify: `apps/merchant/src/components/CheckoutForm.tsx`
- Modify: `apps/merchant/src/app/checkout/page.tsx`

**Interfaces:**

- Consumes: `SheetSession` and `loadCheckoutSession` (Task 6), `PaymentScreen`
  (Task 9).
- Produces:

  ```ts
  // CheckoutPanel.tsx
  export function CheckoutPanel({
    initialSession, merchantName,
  }: { initialSession: SheetSession | null; merchantName: string }): JSX.Element;
  // CheckoutForm.tsx — signature changes
  export function CheckoutForm({
    onSessionStarted,
  }: { onSessionStarted: (session: SheetSession) => void }): JSX.Element;
  ```

- [ ] **Step 1: Make the form report upward instead of navigating**

In `apps/merchant/src/components/CheckoutForm.tsx`:

1. Add the prop and drop `useRouter` (it is no longer used — `noUnusedLocals`
   will catch it if you forget):

   ```tsx
   import type { SheetSession } from "@/lib/checkout-session.js";

   export function CheckoutForm({
     onSessionStarted,
   }: {
     onSessionStarted: (session: SheetSession) => void;
   }) {
   ```

2. Remove `clear` from the `useCart()` destructure and delete the `clear()` call
   in `onSubmit`. Add this comment where the call was:

   ```tsx
       // The cart is NOT cleared here. The basket is the content the payment
       // sheet now sits over, and a declined payment must leave it intact.
       // PaymentScreen clears it on completion instead.
   ```

3. Replace the `router.push(...)` tail of `onSubmit` with a mapping onto
   `SheetSession`:

   ```tsx
       const session = (await sessionResponse.json()) as {
         sessionId: string;
         uri: string | null;
         orderId: string;
         amountCents: number;
         transport: "request_uri" | "dc_api";
         ageRequested: boolean;
         dcApiRequest: unknown;
         state: string;
       };

       onSessionStarted({
         sessionId: session.sessionId,
         orderId: session.orderId,
         amountCents: session.amountCents,
         openid4vpUri: session.uri ?? "",
         transport: session.transport,
         ageRequested: session.ageRequested,
         dcApiRequest: session.dcApiRequest,
         initialState: session.state,
       });
   ```

   Leave `setPending(false)` in the `finally` block as it is.

- [ ] **Step 2: Write the panel**

Create `apps/merchant/src/components/CheckoutPanel.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SheetSession } from "@/lib/checkout-session.js";
import { CheckoutForm } from "./CheckoutForm.js";
import { PaymentScreen } from "./PaymentScreen.js";

/**
 * The checkout page and its payment sheet, in one client component.
 *
 * The sheet used to live on its own route, `/pay/[sessionId]`, which rendered it
 * over an empty page — so its scrim dimmed nothing and it read as a modal over a
 * blank document, because it was one. Here the form and the basket stay mounted
 * behind it, which is what a hosted payment sheet actually feels like and is why
 * the scrim could be lightened to 28%.
 *
 * The session id is mirrored into `?session=` with `replace`, not `push`: Back
 * should return to /cart, not to a checkout form whose order already exists.
 * That parameter is also what survives a coarse-pointer wallet handover, which
 * navigates the tab away entirely (see lib/checkout-session.ts).
 */
export function CheckoutPanel({
  initialSession,
  merchantName,
}: {
  initialSession: SheetSession | null;
  merchantName: string;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SheetSession | null>(initialSession);

  return (
    <>
      {/*
        `inert` while the sheet is open: real focusable content sits behind an
        aria-modal dialog, and a shopper must not be able to Tab into the form
        they are currently being asked to pay for.
      */}
      <div inert={session ? true : undefined}>
        <CheckoutForm
          onSessionStarted={(started) => {
            setSession(started);
            router.replace(`/checkout?session=${started.sessionId}`);
          }}
        />
      </div>

      {session ? (
        <PaymentScreen
          {...session}
          merchantName={merchantName}
          onClose={() => {
            setSession(null);
            router.replace("/checkout");
          }}
        />
      ) : null}
    </>
  );
}
```

- [ ] **Step 3: Make the page read `searchParams`**

Replace `apps/merchant/src/app/checkout/page.tsx`:

```tsx
import { CheckoutPanel } from "@/components/CheckoutPanel.js";
import { SiteHeader } from "@/components/SiteHeader.js";
import { getDb } from "@/db/index.js";
import { env } from "@/env.js";
import { loadCheckoutSession } from "@/lib/checkout-session.js";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  // A wallet round trip on a phone leaves this page and comes back with nothing
  // but the URL, so the sheet is rebuilt from `?session=` rather than from
  // client state. An unknown id renders the ordinary form.
  const initialSession = session ? loadCheckoutSession(getDb(), session) : null;

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="display text-4xl">Check out</h1>
        <p className="mt-3 text-[15px] text-[var(--color-muted-foreground)]">
          We need a name and an email for the receipt. Payment happens in your wallet
          on the next screen.
        </p>

        <div className="mt-8">
          <CheckoutPanel initialSession={initialSession} merchantName={env.MERCHANT_NAME} />
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 4: Typecheck and build**

```bash
pnpm --filter @demo/merchant typecheck
pnpm --filter @demo/merchant build
```

Expected: both PASS. If React rejects `inert={undefined}`, use
`{...(session ? { inert: true } : {})}` instead — do **not** pass
`inert={false}`, which some React versions serialise as the attribute being
present.

- [ ] **Step 5: Verify the gate**

```bash
pnpm check
```

Expected: PASS, **290 tests** — unchanged. Report the measured number.

- [ ] **Step 6: Verify in a real browser — this is the task's whole point**

With a production server and `tools/cdp/cdp.mjs`:

- Add items, go to `/checkout`, submit. The sheet appears **without navigating
  to `/pay/...`**; the URL becomes `/checkout?session=sess_…`.
- The checkout form and the basket aside are **legible behind the sheet**, not
  hidden behind a grey wash.
- Tab from inside the sheet never reaches the form's inputs.
- The basket is still populated while the sheet is open.
- Reload `/checkout?session=sess_…`: the sheet re-opens and polling resumes.
- Cancel closes the sheet, restores `/checkout`, and the basket is intact.
- Navigate `?session=sess_nonexistent`: the ordinary form renders, no error.

- [ ] **Step 7: Commit**

```bash
git add apps/merchant/src/components/CheckoutPanel.tsx \
  apps/merchant/src/components/CheckoutForm.tsx \
  apps/merchant/src/app/checkout/page.tsx
git commit -m "feat(merchant): open the payment sheet over the checkout page

The sheet no longer navigates to its own route, so the scrim finally dims real
content and could drop to 28%. The cart is cleared on completion rather than on
submit, which keeps the basket visible behind the sheet and leaves a declined
payment recoverable. ?session= carries the sheet across a wallet round trip.

Verified in headless Chrome: no navigation on submit, form and basket legible
behind the sheet, Tab trapped, reload re-opens the sheet, an unknown ?session=
degrades to the plain form. The wallet leg is still unexercisable here."
```

---

### Task 11: Real content behind the standalone `/pay` route

Spec §5.5. `/pay/[sessionId]` cannot be deleted — a deep link, a reload in
another browser, or a shared URL has no `localStorage` cart to render behind the
sheet. Instead of a blank page it server-renders the order's own line items, so
the scrim dims real content on this route too.

**Files:**

- Create: `apps/merchant/src/lib/order-lines.ts`
- Create: `apps/merchant/src/lib/order-lines.test.ts`
- Create: `apps/merchant/src/components/OrderSummary.tsx`
- Modify: `apps/merchant/src/app/pay/[sessionId]/page.tsx`

**Interfaces:**

- Consumes: `isAgeRestricted` (Task 2), `AgeChip` (Task 3), `PaymentScreen`
  (Task 9), `loadCheckoutSession` (Task 6).
- Produces:

  ```ts
  // lib/order-lines.ts
  export interface OrderLine {
    productId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
    ageRestricted: boolean;
  }
  export function listOrderLines(db: Db, orderId: string): OrderLine[];
  // components/OrderSummary.tsx
  export function OrderSummary({
    lines, totalCents, customerName,
  }: { lines: OrderLine[]; totalCents: number; customerName: string }): JSX.Element;
  ```

  `listOrderLines` joins `order_items` to `products` for the display name and
  computes `lineTotalCents` from the **snapshotted** `unitPriceCents`, never from
  the live product price — `orders.ts` documents that the snapshot records what
  the customer was actually charged.

- [ ] **Step 1: Write the failing test**

Create `apps/merchant/src/lib/order-lines.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { products } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { createOrder } from "./orders.js";
import { listOrderLines } from "./order-lines.js";

let dir: string;
let db: Db;

const customer = { name: "Ada Lovelace", email: "ada@example.test" };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-ol-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listOrderLines", () => {
  it("returns a display name, quantity and line total per line", () => {
    const created = createOrder(
      db,
      [
        { productId: "cheese", quantity: 2 },
        { productId: "sourdough", quantity: 1 },
      ],
      customer,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const lines = listOrderLines(db, created.orderId);
    expect(lines).toEqual([
      {
        productId: "cheese",
        name: "Aged Gouda",
        quantity: 2,
        unitPriceCents: 449,
        lineTotalCents: 898,
        ageRestricted: false,
      },
      {
        productId: "sourdough",
        name: "Sourdough Loaf",
        quantity: 1,
        unitPriceCents: 399,
        lineTotalCents: 399,
        ageRestricted: false,
      },
    ]);
  });

  it("marks an age-restricted line", () => {
    const created = createOrder(db, [{ productId: "wine", quantity: 1 }], customer);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(listOrderLines(db, created.orderId)[0]?.ageRestricted).toBe(true);
  });

  it("uses the snapshotted unit price, not the current product price", () => {
    // orders.ts snapshots unitPriceCents deliberately: it records what the
    // customer was charged, which a later price change must not rewrite.
    const created = createOrder(db, [{ productId: "cheese", quantity: 1 }], customer);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    db.update(products).set({ priceCents: 9_999 }).run();

    const [line] = listOrderLines(db, created.orderId);
    expect(line?.unitPriceCents).toBe(449);
    expect(line?.lineTotalCents).toBe(449);
  });

  it("returns an empty list for an unknown order", () => {
    expect(listOrderLines(db, "ord_nope")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/order-lines.test.ts
```

Expected: FAIL — `Failed to resolve import "./order-lines.js"`.

- [ ] **Step 3: Write the implementation**

Create `apps/merchant/src/lib/order-lines.ts`:

```ts
import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orderItems, products } from "../db/schema.js";
import { isAgeRestricted } from "./dcql.js";

export interface OrderLine {
  productId: string;
  name: string;
  quantity: number;
  /** What the customer was charged per unit, snapshotted at order time. */
  unitPriceCents: number;
  lineTotalCents: number;
  ageRestricted: boolean;
}

/**
 * The composition of an order, for display.
 *
 * Exists so `/pay/[sessionId]` has real content to render behind the payment
 * sheet. That route has no localStorage cart — it may be a deep link, a reload,
 * or a shared URL — and a scrim over a blank page is what made the sheet read as
 * a modal over nothing.
 *
 * `lineTotalCents` multiplies the SNAPSHOTTED `unitPriceCents`, never the live
 * `products.price_cents`: `orders.ts` records the snapshot precisely so a later
 * price change cannot rewrite what someone was charged. Only the display name
 * comes from the live product row.
 *
 * Returns `[]` for an unknown order rather than throwing — the caller resolves
 * the order first, and an empty basket renders as an empty list.
 */
export function listOrderLines(db: Db, orderId: string): OrderLine[] {
  return db
    .select({
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      unitPriceCents: orderItems.unitPriceCents,
      name: products.name,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId))
    .all()
    .map((row) => ({
      productId: row.productId,
      name: row.name,
      quantity: row.quantity,
      unitPriceCents: row.unitPriceCents,
      lineTotalCents: row.unitPriceCents * row.quantity,
      ageRestricted: isAgeRestricted(row.productId),
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd apps/merchant && pnpm exec vitest run src/lib/order-lines.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the backdrop component**

Create `apps/merchant/src/components/OrderSummary.tsx`:

```tsx
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
```

- [ ] **Step 6: Rewrite the route**

Replace `apps/merchant/src/app/pay/[sessionId]/page.tsx`:

```tsx
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { OrderSummary } from "@/components/OrderSummary.js";
import { PaymentScreen } from "@/components/PaymentScreen.js";
import { SiteHeader } from "@/components/SiteHeader.js";
import { getDb } from "@/db/index.js";
import { orders } from "@/db/schema.js";
import { env } from "@/env.js";
import { loadCheckoutSession } from "@/lib/checkout-session.js";
import { listOrderLines } from "@/lib/order-lines.js";

export const dynamic = "force-dynamic";

/**
 * The standalone payment route. Kept, not deleted: a deep link, a reload in a
 * different browser, or a shared URL has no client cart to render behind the
 * sheet, so /checkout's modal cannot serve those cases.
 *
 * No `onClose` is passed — this is a server component and cannot hand a function
 * across the boundary. PaymentScreen falls back to navigating home, which is the
 * right behaviour here: there is no page underneath to return to.
 */
export default async function PayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const db = getDb();

  const session = loadCheckoutSession(db, sessionId);
  if (!session) notFound();

  const order = db.select().from(orders).where(eq(orders.id, session.orderId)).get();
  if (!order) notFound();

  return (
    <>
      <SiteHeader />

      <main className="mx-auto max-w-md px-5 py-12">
        <OrderSummary
          lines={listOrderLines(db, order.id)}
          totalCents={order.totalCents}
          customerName={order.customerName}
        />
      </main>

      <PaymentScreen {...session} merchantName={env.MERCHANT_NAME} />
    </>
  );
}
```

Note this also removes the route's own duplicated session/order query —
`loadCheckoutSession` already returns exactly the sheet's props, and having two
places build them is how they drift.

- [ ] **Step 7: Verify the gate**

```bash
pnpm check
```

Expected: PASS, **294 tests** (290 + 4). Report the measured number.

- [ ] **Step 8: Verify in a real browser**

With a production server and `tools/cdp/cdp.mjs`:

- Start a payment, note the session id, then open `/pay/<id>` directly in a fresh
  context with no `localStorage`. The order summary renders behind the sheet with
  the right line items and total.
- An age-restricted line carries `18+`.
- `/pay/sess_nonexistent` returns 404.
- Cancel navigates to `/`, not to a blank `/checkout`.

- [ ] **Step 9: Commit**

```bash
git add apps/merchant/src/lib/order-lines.ts \
  apps/merchant/src/lib/order-lines.test.ts \
  apps/merchant/src/components/OrderSummary.tsx \
  "apps/merchant/src/app/pay/[sessionId]/page.tsx"
git commit -m "feat(merchant): render the order behind the standalone pay route

The route keeps working for deep links and reloads, where there is no client cart
to sit behind the sheet, and it now shows the order's real line items instead of
nothing. Line totals come from the snapshotted unit price, not the live product
price. The route's duplicated session query is replaced by loadCheckoutSession so
the two cannot drift.

Verified in headless Chrome with an empty localStorage context; 404 on an unknown
session id confirmed."
```

---

### Task 12: Amend the older spec and the agent guides

Spec §11. The 2026-08-05 design still describes the sheet the code no longer has,
and `AGENTS.md` records constraints this work changed. Both are amended **now**,
after the behaviour landed, so neither ever describes something untrue.

This task adds no tests. It is the last task because its claims must match
measured reality, not the plan's projections.

**Files:**

- Modify: `docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md`
- Modify: `AGENTS.md`
- Modify: `apps/merchant/AGENTS.md`

**Interfaces:** none — documentation only.

- [ ] **Step 1: Measure, before writing any number down**

```bash
pnpm check 2>&1 | tail -30
```

Record the real per-project counts and the total. **Do not** copy 294 from this
plan; a previous plan projected 210 against an actual 218, which is why every
task above says to measure.

- [ ] **Step 2: Amend §9.4 of the older spec**

In `docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md`, replace the
`/checkout` and `/pay/{sessionId}` bullets in §9.4 with:

```markdown
- **`/checkout`** — two columns: a name/email form and the order summary, then
  the primary CTA "Pay with EUDI Wallet" in EudiPay blue `#004DD7` — the one
  place the merchant palette yields to the payment brand. When the basket holds
  an age-restricted product, a consequence line above the CTA states that the
  wallet will confirm the customer is over 18 and will not share a date of
  birth. **The payment sheet opens here, as a modal over this page**, with the
  form and basket still legible behind it; the session id is mirrored into
  `?session=` so a wallet round trip can re-open it. See
  `2026-08-19-payment-sheet-and-age-marking-design.md` §5.
- **`/pay/{sessionId}`** — the standalone fallback for deep links, reloads and
  shared URLs, which have no client cart to render behind the sheet. It
  server-renders the order's line items as that content. See §9.5.
```

Also add to the `/` bullet: age-restricted products carry an `18+` chip on the
shelf ticket.

- [ ] **Step 3: Replace §9.5's visual contract**

Replace the fenced `overlay: / card: / brand blue: …` CSS block and the
"Vertical order" and "Full-viewport centered overlay" paragraphs with:

```markdown
**The visual contract below was superseded on 2026-08-19.** See
`2026-08-19-payment-sheet-and-age-marking-design.md` §3 for the current design —
a saturated `#003BA8` field whose status indicator is the EU twelve-star ring,
with Archivo for the amount and IBM Plex Mono for machine values.

What that redesign **retained** from this section: `#004DD7`, `#FFCC00` and
`#FFEFB4`; `max-width` 400px; the ≤480px bottom-sheet behaviour with
`safe-area-inset-bottom`; `window.location.href = openid4vpUri` on coarse
pointers; `matchMedia("(pointer: coarse)")` for touch detection; no countdown
timer or progress bar; the auto-advance to `/success` after 1.5s.

What it **dropped**: Inter, the 1.5rem radius, the 6px top border, the 240px QR,
the 1.75rem/800 headline, the fullscreen `min-height: 100dvh` centring, and the
spinner. The `box-shadow` this section asked for had been silently dropped in
implementation and is restored.
```

Leave the `postMessage` / iframe history and the `EUDIPAY_REDIRECT` paragraph
intact — that reasoning is still why the route navigates itself.

- [ ] **Step 4: Update the root `AGENTS.md`**

Update the test-count paragraph with your **measured** number, in the voice the
file already uses — it explicitly instructs the reader to distrust numbers in
plans. Then add these entries to `## Hard-won constraints`:

```markdown
- **The payment sheet is a modal on `/checkout`, not a route.** It used to render
  on `/pay/[sessionId]` over an empty page, so its scrim dimmed nothing. The
  sheet now opens without navigation, the session id is mirrored into
  `?session=`, and `/pay/[sessionId]` survives only for deep links and reloads —
  where it renders the order's line items as real content behind the sheet.

- **The cart is cleared when a payment completes, not when the form is
  submitted.** The basket is the content the sheet sits over, and a declined
  payment must leave it intact so "Back to the shop" is recoverable. The
  accepted cost is that abandoning and re-submitting creates a second `pending`
  order.

- **The sheet's rendering decision lives in `lib/sheet-state.ts`, not in JSX.**
  Every vitest project is `environment: "node"` with `include:
  ["src/**/*.test.ts"]`, so a `.tsx` file is never covered. Branching inside the
  component is how a spacing defect in one state stayed invisible from the
  others.

- **`.eudipay-*` classes own their padding and vertical rhythm**, unlike every
  other component class in `globals.css`. The sheet has one instance and its
  rhythm is part of the design; the old split between a stylesheet and `mt-*`
  utilities on inline-level buttons is what produced the reported spacing bugs.
  The sheet also carries the file's only `box-shadow`, on purpose.

- **The `18+` glyph is `18+`, never `+18`**, and it is drawn in Larder's palette
  rather than EudiPay's — an age restriction is the grocer's obligation. Its
  source of truth is `AGE_RESTRICTED_PRODUCT_IDS` in `lib/dcql.ts`, read through
  `isAgeRestricted`, which `selectNamedQuery` also calls so the shelf tag and the
  `dpc` → `dpc_av` escalation cannot disagree. There is no `products` column.

- **A `next/font` variable must not be named after a Tailwind `@theme` token.**
  Already true of `--font-display-face`; now also of `--font-eudipay-face`.
  `@theme` writes its tokens to `:root`, the same element `next/font` writes to,
  so a token defined as `var(--font-eudipay)` referring to itself resolves to
  nothing.
```

- [ ] **Step 5: Update `apps/merchant/AGENTS.md`**

Add the same `sheet-state.ts` and `isAgeRestricted` facts in that file's own
voice, plus one note that `loadCheckoutSession` is the single place the sheet's
props are assembled — both `/checkout` and `/pay/[sessionId]` call it, and adding
a second assembler is how they drift.

- [ ] **Step 6: Confirm nothing in the docs is now false**

```bash
grep -rn "eudipay-card\|eudipay-spinner\|1\.75rem\|240px QR" docs apps/merchant/src AGENTS.md apps/merchant/AGENTS.md
```

Expected: hits only inside the 2026-08-19 spec's own list of dropped values and
inside the §9.5 supersession note. Anything else is a stale claim — fix it.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md \
  AGENTS.md apps/merchant/AGENTS.md
git commit -m "docs: amend the 2026-08-05 spec and the agent guides

§9.4 and §9.5 described a sheet the code no longer has. The retained constraints
are listed explicitly rather than the section being deleted, so the reasoning
behind the coarse-pointer redirect and the bottom-sheet behaviour survives.

The test count in AGENTS.md is the measured one, not this plan's projection."
```

---

## Verification summary

What this plan proves, and what it cannot.

**Covered by unit tests** (all four projects, `environment: "node"`):
star geometry; `isAgeRestricted` agreeing with `selectNamedQuery`; the derived
`ProductDto.ageRestricted`; `cartHasAgeRestricted`; all six sheet states plus
both DC-API failure modes and both poll failure modes; the widened
`startPaymentSession` result; `loadCheckoutSession` for live, aged, `dc_api`,
terminal and unknown sessions; `listOrderLines` including the snapshotted price.

**Covered by headless Chrome against a production server** (Tasks 3, 9, 10, 11):
the `18+` chip on exactly three tickets; the consequence line appearing and
disappearing with the cart; no navigation on submit; the checkout legible behind
the sheet; the focus trap; `Escape`; reload re-opening the sheet; an unknown
`?session=` degrading to the plain form; the order summary behind `/pay`.

**Not verifiable here, and not to be claimed:**

- No wallet exists in this environment — no phone, no EUDI wallet app. The
  **approved** state's ring completion is verified only by forcing the session
  row to `completed`, never by a real `DigitalCredential`.
- `navigator.credentials.get()` only ever throws here, which is what exercises
  the "Show QR code" recovery. `submitDcApiResponse` has still never been called
  against a real foundry.
- The coarse-pointer deep-link path can be simulated with a `(pointer: coarse)`
  emulation, but the return leg — a wallet handing the tab back — cannot.
- foundry's `verifier.dc_api_expected_origins` must list the merchant origin or a
  DC API payment fails `transaction_data_binding` as a *decline*, silently. That
  is unchanged by this work and is not a UI defect.
