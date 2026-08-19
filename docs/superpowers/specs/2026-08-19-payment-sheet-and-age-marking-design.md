# Payment sheet redesign and age-restriction marking — design

**Date:** 2026-08-19
**Scope:** `apps/merchant` (storefront, checkout, payment sheet), `packages/ui`
**Amends:** `docs/superpowers/specs/2026-08-05-payment-banking-demo-design.md` §9.4 and §9.5

---

## 1. Purpose

Three complaints, one surface:

1. Age-restricted products are indistinguishable on the shelf, even though an
   age-restricted basket silently changes the payment presentation from the
   `dpc` named query to `dpc_av`. The demo's central claim — that a wallet can
   prove age without disclosing a birthdate — is currently invisible in the UI.
2. The payment sheet has real layout defects and reads as cheap.
3. The payment sheet renders on an otherwise empty route, so its scrim dims
   nothing. It looks like a modal over a blank page, because it is one.

This document specifies the design and the structural changes that follow from
it. It does not change the OpenID4VP wire, the settle gate, foundry
integration, or the bank REST contract.

## 2. Decisions taken

Recorded because each one closes off alternatives that would otherwise look
reasonable to a later reader.

| # | Decision | Rejected alternative |
| --- | --- | --- |
| D1 | The sheet is a **modal on `/checkout`**, opened without navigation. `/pay/[sessionId]` survives as a standalone fallback. | A backdrop faked behind `/pay`; Next.js intercepting routes. |
| D2 | EudiPay's **`#004DD7` / `#FFCC00` / `#FFEFB4` are locked**; layout, typography, elevation and state choreography are redesigned freely, and §9.5 is amended to match. | Preserving §9.5's visual contract verbatim; redesigning the palette too. |
| D3 | Age restriction is marked **on the shelf, in the basket, and as a consequence line at checkout**. | Shelf only; also enumerating requested attributes on the sheet. |
| D4 | The sheet becomes a **saturated EU-blue instrument**, not a white card on grey. | Frosted glass; a card-terminal readout. |
| D5 | The **twelve stars leave the logo** and become the sheet's status indicator. | Keeping the CSS spinner and a separate success tick. |

## 3. Design system — the EudiPay sheet

### 3.1 Colour

Six values. The first three are locked by D2; `#003BA8` already exists in
`EudiPayLogo.tsx` as the card's stripe, so it is an existing brand shade rather
than a new invention.

| Token | Value | Role |
| --- | --- | --- |
| `--ep-field` | `#003BA8` | The sheet's ground. The whole instrument. |
| `--ep-blue` | `#004DD7` | QR dark modules; ink on white controls; the mark's stripe. |
| `--ep-star` | `#FFCC00` | Lit stars, eyebrow labels, data-cell keys. |
| `--ep-star-dim` | `rgb(255 204 0 / 0.22)` | Unlit stars. |
| `--ep-badge` | `#FFEFB4` | Status pill ground (text `#5A4400`). |
| `--ep-alarm` | `#FFB3B3` | Failure eyebrow and glyph. Nothing else. |

Red is deliberately a tint rather than a saturated stop: on a blue field a
saturated red vibrates, and the failure is already carried by an emptied ring
and a headline.

### 3.2 Type

The sheet must not speak in Larder's voice — the handover only reads as a
handover if the typography changes hands. Larder keeps Bricolage Grotesque;
the sheet gets **Archivo**, a variable grotesque with a width axis, used wide
for the amount so the number reads as signage on an official instrument rather
than as UI text. **IBM Plex Mono** is already loaded and sets every machine
value. **Instrument Sans** stays for running copy.

| Role | Face | Size / weight | Notes |
| --- | --- | --- | --- |
| Amount | Archivo `wdth 125` | 52px / 700, `-0.035em`, tabular | 36px in the QR variant |
| Amount eyebrow | Plex Mono | 10px / 600, `0.16em`, upper | `--ep-star` |
| Wordmark | Archivo `wdth 108` | 16px / 700, `-0.02em` | |
| Outcome headline | Archivo `wdth 104` | 18px / 700 | Approved / declined only |
| Data key | Plex Mono | 9px / 500, `0.14em`, upper | `--ep-star` at 85% |
| Data value | Plex Mono | 12.5px / 500 | |
| Status pill | Instrument Sans | 12px / 600 | |
| Running copy | Instrument Sans | 13px / 400, 1.45 | white at 72% |
| Button | Instrument Sans | 15px / 600 | |
| Failed checks | Plex Mono | 11px / 400 | white at 62% |

`next/font` variable name must be `--font-eudipay`, **not** `--font-display` —
`layout.tsx` documents why: Tailwind's `@theme` defines `--font-display` on
`:root`, the same element `next/font` writes to, and a self-referential token
resolves to nothing.

### 3.3 Layout

Sheet is `max-width: 25rem` with a `1rem` gutter, centred, vertically scrollable
if it exceeds the viewport. Radius `20px`. Ground `--ep-field`. Elevation
`0 26px 60px -22px rgb(0 20 70 / 0.55)` — a real shadow, because the sheet is
lifted off the shop and needs to say so. (Larder's own no-shadow rule stands;
it is a rule about the *shop's* surfaces, and the sheet is not one. The comment
in `globals.css` will be amended to say this rather than deleted.)

Spacing is a 4px scale: `8 / 12 / 16 / 20 / 24 / 32`. **The sheet owns its own
padding and vertical rhythm in CSS**, deliberately breaking the file's existing
"component classes declare appearance only, never padding or margin" convention.
That convention exists so the shop's markup can tune spacing per instance; the
sheet has exactly one instance, its rhythm is part of the design, and splitting
it between a stylesheet and a scatter of `mt-*` utilities is precisely what
produced the current defects. The deviation is documented in place.

```text
┌───────────────────────────────┐
│         ✦ ✦ ✦ ✦ ✦             │   twelve-star ring, 112px
│      ✦   ┌─────┐   ✦          │   card mark inside, 60px
│      ✦   │ ▬▬▬ │   ✦          │
│       ✦  └─────┘  ✦           │
│          EudiPay              │   Archivo 16
├───────────────────────────────┤   1px rgb(255 204 0 / .42), full bleed
│  AMOUNT TO AUTHORISE          │   Plex Mono 10, star yellow
│  € 17.47                      │   Archivo wdth125 52
│  ┌────────────┬────────────┐  │
│  │ PAYEE      │ ORDER      │  │   data strip, 1px rules
│  │ Larder     │ LD-7F3A29  │  │
│  └────────────┴────────────┘  │
│      ( Waiting for … )        │   pill, #FFEFB4
│  ┌───────────────────────┐    │   ── QR variant only ──
│  │        [ QR ]         │    │   white inset: the window
│  └───────────────────────┘    │
│  Scan with your EUDI Wallet.  │   13px, white 72%
│  ┌───────────────────────┐    │   ── same-device only ──
│  │ Approve in your wallet│    │   white button, blue ink
│  └───────────────────────┘    │
│           Cancel              │   underlined, white 70%
└───────────────────────────────┘
```

The amount is the largest object in every state, including the failure states —
the shopper's question is always "what happened to my €17.47", never "what is
this dialog".

### 3.4 Signature: the stars leave the logo

`EudiPayLogo.tsx` currently draws a payment card **and** a twelve-star ring
inside one 100×100 mark. The stars migrate out: the mark becomes a card only,
and the ring becomes a separate, larger element that encircles it and reports
state.

This is the sheet's one bold move, and everything else stays quiet to pay for
it. It is worth making because the ring is the only status indicator that keeps
its meaning across *all* states — a spinner cannot express "eleven of twelve" or
"declined" — and because it is the brand's own iconography rather than borrowed
UI furniture.

Ring behaviour:

`litStars` is the count of lit stars, filled clockwise from twelve o'clock.
"Cycling" means it runs 1 → 12 and restarts at 1, indefinitely, at one step per
400ms; it is a liveness indicator, not a progress bar, because the wallet's
progress is unknowable from here.

| State | Lit | Centre glyph | Motion |
| --- | --- | --- | --- |
| DC API, before the press | 4 | card | none — nothing is happening yet |
| Waiting for wallet (QR) | cycling 1→12 | card | one star per 400ms, clockwise, looping |
| Opening wallet (deep link) | cycling 1→12 | card | as above |
| Settling | 11 | card | the 11th pulses; the 12th belongs to the bank |
| Approved | 12 | check | 12th lands, then the glyph crossfades to a check |
| Declined | 0 | alert | ring empties over 240ms |

Under `prefers-reduced-motion: reduce` the ring is **static at 6 lit stars**
while waiting and jumps directly to its terminal value — no rotation, no
crossfade. It must never be the *only* signal: every state also has a pill or a
headline in text, and the ring itself is `aria-hidden`.

Implementation: `apps/bank/src/components/EuStars.tsx` already generates correct
five-pointed star paths. That maths moves to `packages/ui/src/euStars.ts` as
pure, unit-tested functions (`starPath`, `ringPoints`); both apps' components
consume it. Dots are not acceptable — the EU mark is stars.

## 4. The sheet's state machine

The current `PaymentScreen` decides what to render through nested ternaries
inside JSX. That is why a padding bug in one branch is invisible from the
others. The decision moves into a pure module, matching the convention
`AGENTS.md` records for the DC API work ("keep decisions in `.ts`, rendering in
`.tsx`"), and becomes testable under the node-environment vitest projects.

New `apps/merchant/src/lib/sheet-state.ts`:

```ts
export interface SheetInput {
  state: string;                       // session state from the poll
  transport: "request_uri" | "dc_api";
  ageRequested: boolean;               // namedQueryRef === "dpc_av"
  redirecting: boolean;
  dcBusy: boolean;
  dcFailed: boolean;
  pollStatus: "running" | "failed" | "timeout" | null;
  failureReason?: string;
}

export interface SheetView {
  phase: "authorise" | "waiting" | "settling" | "approved" | "declined";
  eyebrow: string;                     // "Amount to authorise" | "Paid" | "Not paid"
  litStars: number;                    // 0..12
  glyph: "card" | "check" | "alert";
  animate: boolean;
  pill: string | null;
  headline: string | null;
  body: string;                        // instruction / explanation
  showQr: boolean;
  showWalletButton: boolean;
  primaryAction: "approve" | "retry" | "show-qr" | null;
  showCancel: boolean;
  showBackToShop: boolean;
}
```

`selectSheetView(input): SheetView` is exhaustive over the inputs and is where
the failure-message table currently living in `PaymentScreen` moves to. The
component becomes a renderer with no branching beyond `view.showQr &&`.

Two behaviours worth stating because they are changes, not restatements:

- **Cancel is withdrawn in `settling`.** The money is in flight; offering a
  cancel that cannot cancel is a lie.
- **The DC API pre-press state shows no status pill.** Nothing is waiting until
  the button is pressed. The pill currently reads "Waiting for your wallet"
  before the user has done anything.

## 5. Overlay architecture (D1)

### 5.1 What changes

Today: `CheckoutForm` POSTs the order, POSTs the session, calls `clear()`, then
`router.push('/pay/<id>')`. `/pay/[sessionId]` server-renders `PaymentScreen`
into an empty page.

After: a new client component **`CheckoutPanel`** owns both the form and the
sheet. On a successful session POST it stores the session in state and renders
`PaymentScreen` as a sibling overlay. No navigation occurs.

```text
/checkout (server)
  └─ CheckoutPanel (client)
       ├─ CheckoutForm  (extracted; form + basket aside, unchanged in behaviour)
       └─ PaymentScreen (rendered only when a session is open)
```

`CheckoutPanel` also calls `router.replace('/checkout?session=<id>')` when the
sheet opens. `replace`, not `push`: the browser Back button should return to
`/cart`, not to a checkout form whose order already exists.

### 5.2 Surviving the wallet round trip

On a touch device with `request_uri`, the sheet sets
`window.location.href = openid4vpUri` and the tab leaves the page entirely.
When the wallet returns the shopper, `/checkout` re-mounts from scratch. Without
the `?session=` parameter they would land on a bare form.

`/checkout` therefore becomes a server component that reads `searchParams`, and
when `session` is present loads the session and its order with the same query
`/pay/[sessionId]` uses, passing the result to `CheckoutPanel` as
`initialSession`. No new API surface is needed for this path.

### 5.3 The cart is no longer cleared on submit

`clear()` moves out of `onSubmit` and into the sheet's completion transition,
immediately before the redirect to `/success`. Three reasons:

- The basket aside must stay populated — it is the content the sheet now sits
  over, and it is the total the shopper is being asked to trust.
- A declined or cancelled payment leaves the basket intact, which is what a
  shopper expects and what makes "Back to the shop" recoverable.
- The order row is already created and priced server-side, so the cart is no
  longer load-bearing once the session exists; clearing it early was only ever
  a tidy-up.

Consequence, accepted: abandoning and re-submitting creates a second `pending`
order. That is already true today via "Back to the shop" and costs nothing in a
demo.

### 5.4 The POST response grows

`POST /api/payment-sessions` currently returns `{ sessionId, uri }`. The sheet
needs more, and it must have it **as a prop before any click** — `AGENTS.md`
records that no `await` may execute between a click handler starting and
`navigator.credentials.get()`, because Chrome consumes the click's transient
activation.

The 201 body becomes:

```json
{ "sessionId": "sess_…", "uri": "openid4vp://…", "orderId": "ord_…",
  "amountCents": 1747, "transport": "dc_api", "ageRequested": true,
  "dcApiRequest": {}, "state": "pending" }
```

`dcApiRequest` is `null` for a `request_uri` session, and `uri` is `null` for a
`dc_api` one — foundry returns neither `openid4vp_uri` nor `request_uri` for an
inlined request object. `uri` is retained under its current name so the existing
caller keeps working.

`amountCents` comes from the order row, never from the client's cart total — the
amount the sheet displays must be the amount that was bound into
`transaction_data`.

The new fields are added to `StartPaymentSessionResult` in
`lib/payment-sessions.ts` and the route handler only serialises them. That is
deliberate: there are currently **no tests under `src/app`** — every merchant
test sits on `src/lib` or `src/db` — so putting the decision in the library keeps
it inside the tested surface instead of establishing a new route-test pattern
for one response shape.

### 5.5 `/pay/[sessionId]` keeps working, and gets real content behind it

The route is not deleted, because a deep link, a reload in a different browser,
or a shared URL has no `localStorage` cart to render behind the sheet. Instead
of a blank page it server-renders an **order summary** from `order_items` — line
items, quantities, total, in the same visual language as the checkout aside.
That is honest content derived from the order, not decoration, and it resolves
complaint 3 on this route too.

### 5.6 Scrim and inertness

The scrim drops from `rgb(11 18 32 / 0.55)` + `blur(6px)` to
**`rgb(11 18 32 / 0.28)` + `blur(2px)`** — enough to establish depth and to
keep the sheet's own contrast, light enough that the shop is legible behind it,
which is the entire point of D1.

Because real, focusable content now sits behind an `aria-modal` dialog, the
page content must be made inert while the sheet is open: `inert` on the
checkout wrapper, focus moved to the sheet on open, focus restored on close,
`Escape` bound to Cancel (except in `settling`, where Cancel does not exist).

## 6. Defects being fixed

Enumerated so the implementation can be checked against them.

1. **`.eudipay-button` has no horizontal padding.** It is `inline-flex` and the
   markup only ever adds `py-3`, so every label runs to its own edges. Buttons
   become block-level, full-width, with their own padding.
2. **Buttons are inline-level children of a `text-align: center` card**, so
   their vertical spacing comes from line boxes and `mt-*` on inline elements.
   Replaced by a declared flow rhythm (§3.3).
3. **`.eudipay-card` declares no padding**; `px-7 py-8` lives in the markup, so
   the negative-margin full-bleed rule (`.eudipay-rule`) can only work by
   guessing that number. The card owns its padding.
4. **`min-height: 100dvh` on a `position: fixed; inset: 0` overlay** is
   redundant and blocks scrolling a tall sheet. Removed in favour of
   `overflow-y: auto` and `padding-block`.
5. **Focus rings are invisible on the sheet.** `.eudipay-card :focus-visible`
   sets `outline-color: #004DD7`, which on a `#003BA8` field is nearly
   invisible. Becomes `--ep-star`.
6. **§9.5's `box-shadow` was silently dropped**, leaving a white card on grey
   with no elevation — a large part of why the sheet reads as cheap. Restored
   per §3.3, with the reasoning recorded so it is not "cleaned up" again.
7. **`prefers-reduced-motion` only neutralises three animations** and leaves the
   spinner spinning at 2.4s. The ring's reduced-motion behaviour is specified in
   §3.4.

## 7. Age-restriction marking (D3)

### 7.1 Where the flag comes from

`AGE_RESTRICTED_PRODUCT_IDS` stays exactly where it is, in
`apps/merchant/src/lib/dcql.ts`, with its comment intact. Its own instruction is
to promote it to the schema only "the moment anything other than this list needs
to change it" — rendering a tag is a second *reader*, not a second writer, so the
list stays hardcoded and a new exported predicate is added beside it:

```ts
export function isAgeRestricted(productId: string): boolean;
```

`selectNamedQuery` is refactored to call it, so the storefront tag and the
`dpc` → `dpc_av` escalation can never disagree. `ProductDto` gains a derived
`ageRestricted: boolean`, set in `toDto`. No migration, no column, no editing
surface implied.

`CartItem` gains nothing: the cart already stores `productId`, and the cart
views call `isAgeRestricted` directly. `dcql.ts` is pure TypeScript with no
node dependencies, so importing it into a client component is safe.

### 7.2 The mark

A single chip, one definition, three placements. Ground `--color-ink`, text
`--color-ticket` (Larder's shelf-label yellow), IBM Plex Mono, `10px/600`,
`0.02em`, radius `3px`, padding `1px 5px`, glyph **`18+`**.

Deliberately in Larder's palette, not EudiPay's: the restriction is the
*grocer's* legal obligation and belongs to the shop's voice. It appears in the
EudiPay sheet only as a clause of running copy, never as this chip.

`--color-ticket` currently appears in exactly one place (the ticket's left rail)
and `globals.css` says so; that comment is updated to name both uses.

Placements:

- **Shelf ticket** — on the ticket's top line, right-aligned opposite the
  product name. On the label, not on the photograph: a real grocer prints age
  restriction on the shelf edge, and the ticket is already this design's
  shelf edge.
- **Cart line** — after the product name.
- **Checkout basket line** — after the product name, same as the cart.
- **Success receipt** — not marked. The purchase is complete; the restriction is
  no longer actionable information.

```text
┌─────────────────────┐
│                     │
│      [ photo ]      │
│                     │
├─────────────────────┤  ← ticket, yellow rail at left
│ Riesling, Trocken  [18+] │
│ Dry, mineral, from …│
│                     │
│ €8.99               │
│ 750 ml · €11.99/l   │
└─────────────────────┘
```

### 7.3 The consequence line

Rendered above the checkout submit button, only when the basket contains a
restricted item:

> **18+** Your wallet will confirm you're over 18. It won't share your date of
> birth.

Two sentences, both load-bearing: the first says what will happen, the second
says what will not — which is the actual claim this demo exists to make. It is
derived from the live cart on the client, so it appears and disappears as items
are added and removed.

### 7.4 The sheet's clause

When the session's `namedQueryRef` is `dpc_av`, the sheet's instruction copy
gains one clause:

- QR: "Scan with your EUDI Wallet to approve the payment and confirm you're
  over 18."
- Same device: "Your wallet will confirm the amount and that you're over 18."

This requires `namedQueryRef` to reach `PaymentScreen` — it is already on the
session row, and is surfaced as `ageRequested: boolean` (§5.4) rather than as
the raw query name, because the sheet has no business knowing foundry's query
vocabulary.

This is a small extension of D3, which stopped at the checkout line. It is one
clause of a sentence the sheet already shows, not a list of requested
attributes — the wallet's own screen remains the place where attributes are
enumerated, and duplicating that list here was explicitly rejected.

## 8. Copy

Every string on the sheet, so the vocabulary can be checked for consistency in
one place. Active voice; an action keeps its name through the flow.

| Slot | Text |
| --- | --- |
| Amount eyebrow | Amount to authorise / Paid / Not paid |
| DC API button | Approve in your wallet |
| DC API body | Your wallet will confirm the amount[ and that you're over 18]. |
| Deep-link pill | Opening your wallet… |
| Deep-link body | Approve the payment in your EUDI Wallet, then come back to this tab. |
| QR pill | Waiting for your wallet |
| QR body | Scan with your EUDI Wallet[ to approve the payment and confirm you're over 18]. |
| Settling pill | Contacting your bank… |
| Settling body | Your wallet approved the payment. Don't close this tab. |
| Approved headline | Payment approved |
| Approved body | Taking you to your receipt… |
| Declined headline | Payment declined |
| Declined body | (existing `FAILURE_MESSAGE` table, unchanged) |
| Declined checks | failed: `<check names>` |
| Actions | Try again · Show QR code · Back to the shop · Cancel |

"Payment successful" becomes "Payment approved" to match the eyebrow's "Paid"
and the verb the shopper performed. `FAILURE_MESSAGE`'s wording is not
relitigated here — it is already written from the shopper's side.

## 9. Accessibility

- Sheet keeps `role="dialog" aria-modal="true"`, gains a focus trap, initial
  focus on the primary action (or the sheet itself when there is none), focus
  restoration on close, and `Escape` → Cancel where Cancel exists.
- Content behind the sheet is `inert` while it is open (§5.6).
- The ring is `aria-hidden`; state is announced through a `role="status"`
  region carrying the pill or headline text.
- Contrast on the `#003BA8` field, computed rather than estimated: white
  **9.3:1**, `#FFCC00` **6.1:1**, `#FFB3B3` **5.4:1**; the `#FFEFB4` pill
  carries `#5A4400` at **8.1:1**. All clear AA for normal text (4.5:1), so none
  of them depends on being classed as large text.
- The QR stays `#004DD7` on `#FFFFFF` inside the white inset — scanner contrast
  is not negotiable, which is why the inset exists.

## 10. Testing

All four vitest projects run `environment: "node"` and match only
`src/**/*.test.ts`, so `.tsx` is not covered. Decisions therefore live in `.ts`
and are tested there; rendering is verified in a real browser via
`tools/cdp/cdp.mjs`.

New and changed unit tests:

- `packages/ui/src/euStars.test.ts` — `ringPoints` places twelve points at the
  expected angles starting at twelve o'clock; `starPath` is closed and has ten
  vertices.
- `apps/merchant/src/lib/dcql.test.ts` — `isAgeRestricted` for each seeded
  product id; `selectNamedQuery` still agrees with it.
- `apps/merchant/src/lib/queries.test.ts` — `ageRestricted` is true for exactly
  `beer`, `wine`, `aperitif`; the DTO key list gains the field.
- `apps/merchant/src/lib/sheet-state.test.ts` — one case per row of §3.4's table
  plus the DC-API-failed recovery and the poll `failed` / `timeout` outcomes:
  asserts `litStars`, `glyph`, `showQr`, `showWalletButton`, `showCancel`,
  `primaryAction`, and that `ageRequested` alters only `body`.
- `apps/merchant/src/lib/checkout-session.test.ts` — the `?session=` loader
  returns the sheet's props for a live session and `null` for an unknown id.
- `apps/merchant/src/lib/payment-sessions.test.ts` (existing file) — the
  `startPaymentSession` result carries `amountCents` from the order row,
  `transport`, `ageRequested`, and `dcApiRequest`, with `dcApiRequest` null for
  a `request_uri` session and `uri` null for a `dc_api` one.

Browser verification, against a production server (`pnpm build` then
`pnpm --filter @demo/merchant start` — `pnpm dev` is broken, see `AGENTS.md`):

- The shelf shows `18+` on exactly three tickets.
- Adding a restricted item makes the consequence line appear at checkout;
  removing it makes it disappear.
- Submitting opens the sheet **without navigation**, the URL becomes
  `/checkout?session=…`, and the checkout form and basket are legible behind it.
- Reloading `/checkout?session=…` re-opens the sheet with polling resumed.
- `/pay/<id>` renders the order summary behind the sheet.
- A `dc_api` session renders the button and no QR; a `request_uri` session on a
  fine pointer renders the QR.

Baseline is **253 tests** as of 2026-08-19. The plan must state a projected
count and the implementation must report the measured one; a previous plan
projected 210 against an actual 218 by mis-counting `it()` blocks.

## 11. Amendments to the 2026-08-05 spec

- **§9.4** — `/checkout` gains the consequence line and is now the surface the
  payment sheet opens over; `/pay/{sessionId}` is redescribed as the standalone
  fallback with an order-summary backdrop.
- **§9.5** — the "visual contract, preserved from the original" block is
  replaced by §3 of this document. The retained constraints are: `#004DD7`,
  `#FFCC00`, `#FFEFB4`, `max-width` 400px, the ≤480px bottom-sheet behaviour
  with `safe-area-inset-bottom`, `window.location.href = openid4vpUri` on coarse
  pointers, `matchMedia("(pointer: coarse)")` for touch detection, no countdown
  timer or progress bar, and the auto-advance to `/success` after 1.5s. Dropped:
  Inter, the 1.5rem radius, the 6px top border, the 240px QR, the 1.75rem/800
  headline, the fullscreen `min-height: 100dvh` centring, and the spinner.

Both amendments are edits to the older spec file, made in the commit that lands
the corresponding behaviour — not in this one. Until then §9.5 correctly
describes what the code still does, and this document describes what it will do.

## 12. Out of scope

- No revocation, no new foundry endpoints, no schema migration.
- No change to the bank app beyond `EuStars.tsx` consuming the shared star
  maths.
- Design tokens stay unshared between the two apps; only the star geometry
  moves into `packages/ui`, which is behaviour.
- `pnpm dev` remains broken for the reasons `AGENTS.md` records; this work does
  not attempt to fix it.

## 13. Known-unverifiable

The wallet leg cannot be exercised here — no device, no EUDI wallet. So:

- No `DigitalCredential` will ever be returned, so the **approved** state's ring
  completion cannot be observed end to end. It will be verified by driving
  `selectSheetView` in tests and by forcing the session row to `completed` in
  the database and reloading the sheet.
- The `dc_api` **declined** path is reachable locally only because
  `navigator.credentials.get()` throws, which is what exercises the "Show QR
  code" recovery.
- foundry's `verifier.dc_api_expected_origins` must list the merchant origin or
  a DC API payment fails `transaction_data_binding` as a *decline* rather than a
  transport error. That is unchanged by this work and is not a UI defect.
