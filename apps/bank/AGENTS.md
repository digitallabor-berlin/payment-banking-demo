# AGENTS.md — apps/bank

The online-banking app. Read the root `AGENTS.md` first — every constraint there
applies here. This file covers only what is specific to the bank.

## Role in the demo

The bank is the **credential issuer** and the **money mover**:

1. Issues the girocard into the user's wallet in **two formats**, through the
   one route `POST /api/cards/{id}/credential` (polled via
   `GET /api/credentials/{id}/status`): `com.emvco.dpc.card` behind the *Add to
   Google Wallet* badge, and `sparkassencard` behind the *Add to EUDI Wallet*
   button. Both are payable and their claim sets share nothing — see **Two card
   formats** below. Only the DPC's happy case has ever run.
   It also issues an age-verification attestation
   (`POST /api/credentials/av`, type id `av-sparkasse`) — see **Age-verification
   credential** below; that path's happy case has never run.
   And it issues **Wero** (type id `wero`) through that same card route, behind a
   single *Add to EUDI Wallet* button on its own tile — see **Wero credential**
   below; that path's happy case has never run either.
2. Debits the account when the merchant presents a verified join key
   (`POST /api/payments`).

It is the **sole owner of credential state**. The merchant has no `credentials`
table and never persists one — it only forwards a `credential_id` string.

## Identity

- Port **3001**. **English by default, German via a one-click switcher**;
  Sparkasse-styled in both. English is the default because this app is
  demonstrated to audiences who do not read German. See **i18n** below.
- Package `@demo/bank`.
- The only app with a login, so the only one with `jose` and `SESSION_SECRET`.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | no | `3001` | Listen port |
| `DATABASE_PATH` | no | `./data/bank.db` | SQLite file; directory must be writable |
| `BANK_PUBLIC_URL` | no | `http://localhost:3001` | Own external origin |
| `FOUNDRY_ADMIN_URL` | no | `http://127.0.0.1:9000` | foundry admin listener |
| `FOUNDRY_ADMIN_KEY` | **yes** | — | Bearer token for foundry's admin API |
| `BANK_API_KEY` | **yes** | — | Shared secret the merchant presents on `POST /api/payments`; must match the merchant's own `BANK_API_KEY` |
| `SESSION_SECRET` | **yes** | — | JWT signing key, ≥ 32 chars |

`cp .env.example .env.local` for local work.

## Schema (`src/db/schema.ts`)

`users`, `accounts`, `cards`, `credentials`, `transactions`.

- `credentials.credentialTypeId` is the type discriminator:
  `com.emvco.dpc.card | sparkassencard | wero | av | av-sparkasse`, **defaulting
  to the DPC**. The default is what made migration `0001`'s backfill automatic and kept
  the eight pre-existing `insert(credentials)` sites compiling. The cost is real:
  an insert that *forgets* the field silently becomes a payment credential, so
  `startAvIssuance` names its type explicitly and a test asserts it, and
  `startIssuance` takes the format as a **required** parameter rather than
  defaulting it. Constants live in `src/lib/credential-types.ts`, bound to the
  schema enum with `satisfies`, in their own module so `payments.ts` can name
  the payment types without importing the issuance path (which would drag in the
  foundry client, `env`, and the display builders).
- **Widening that enum costs no migration.** The column is plain `text` and
  `0001` emits no CHECK constraint, so the enum is a TypeScript claim about the
  data rather than a database one. Adding `sparkassencard` and `av-sparkasse`
  was a one-line schema edit and zero SQL, and so was adding `wero`.
- **`av` is NOT legacy — it is the age credential's Google Wallet format.**
  It once was: the age credential became `av-sparkasse`, nothing issued `av`,
  and `getAgeCredentialState` ignored it, so a leftover row read as "not in
  wallet". Both ids are now live and carry byte-identical `AV_CLAIMS`
  (`AGE_CREDENTIAL_TYPE_IDS`, `isAgeCredentialType`), so a **pre-existing `av`
  row now reads as in-wallet** in the Google format. `startAvIssuance` takes the
  format as a required parameter, exactly like `startIssuance`.
- `credentials.cardId` and `credentials.credentialId` are both **nullable**. An
  age credential has neither: it attests a property of the person, and it
  discloses no join key at all. SQLite treats NULLs as distinct under a UNIQUE
  index, so the DPC uniqueness invariant survives.
- `credentials.credentialId` is **UNIQUE** — the loop's join key. States:
  `offered | active | failed`.
- **Three independent reasons an age credential cannot move money.**
  `processPayment` rejects a `credentialTypeId` that fails
  `isPaymentCredentialType`, rejects a null `cardId` (compiler-forced by the
  nullable column), and its lookup is `where credential_id = <string>`, which
  SQL never matches against NULL. The first guard asks the predicate rather than
  naming one id: both card formats authorize money to move, and both age
  formats are refused even though the column holds them —
  `isAgeCredentialType` and `isPaymentCredentialType` are deliberately disjoint,
  and a test asserts they share no id.
- **`drizzle-kit generate` emitted a broken `0001`.** The table rebuild's
  `INSERT … SELECT` listed `credential_type_id` on *both* sides, selecting a
  column the old table does not have (`no such column: "credential_type_id"`),
  which made the migration unrunnable and failed every test in
  `schema.test.ts`. The committed SQL is hand-edited to omit it so the column
  DEFAULT backfills. **Read generated migration SQL; do not assume it runs.**
- `transactions.idempotencyKey` is nullable with a **UNIQUE index**. Nullable so
  seeded history rows can leave it empty (SQLite permits many NULLs under a
  unique index); unique so a replayed settle call cannot double-debit.
- `transactions.amountCents` is **negative for a debit**, positive for a credit.
- `transactions.credentialId` being non-null is what makes the UI render the
  "EUDI Wallet" badge — but via a derived boolean, not the raw value:
  `listTransactions` maps it to `paidWithWallet: row.credentialId !== null`
  (`src/lib/queries.ts`), and `TransactionRow` reads only that. The DTO
  deliberately never exposes the credential id to the browser.

## Seed fixtures (`src/db/seed.ts`)

Two users, password `demo1234` for both:

| User | Account | Balance | Card |
| --- | --- | --- | --- |
| `anna` (`user_anna`) | `acc_anna` | `348712` cents | `card_anna`, girocard 4242 |
| `ben` (`user_ben`) | `acc_ben` | `129540` cents | `card_ben`, girocard 8815 |

Ten booked transactions each (20 total). **No credentials are seeded** — issuing
one requires a real wallet. To exercise a payment path without a device, insert
a synthetic `active` credential with a scratch script (see root `AGENTS.md`).

`seed()` deletes every row first, so `pnpm seed` returns the demo to a known
state.

Two fixture properties are load-bearing for issuance, and `seed.test.ts` asserts
both against the seeded rows rather than the fixture array:

- **Every IBAN must end in four digits.** `lib/display-metadata.ts` derives the
  DPC `card.last_four` from the IBAN — *not* from `panLast4`, which is why
  `card_anna` sends `2051` (from `DE02120300000000202051`) and not `4242`.
  foundry enforces `^[0-9]{4}$` and rejects the entire offer otherwise.
- **Both cards are `girocard`.** It is the only network `NETWORK_LOGOS` has an
  asset for, and the merchant's own fixtures already assumed it — they used to
  disagree with the bank's `VISA`/`Mastercard`. An unknown network still yields a
  valid offer (branding degrades to a name with no logo), so this is a fidelity
  requirement, not a correctness one.

## DPC display metadata (`src/lib/display-metadata.ts`)

Issuance sends foundry two independent display arrays, validated against
*different* rules:

| Field | foundry stage | `last_four` / `alias` / `card_art` |
| --- | --- | --- |
| `offer_display` | `DisplayStage::Offer` | withheld — PII must not appear on an offer |
| `credential_response_display` | `DisplayStage::CredentialResponse` | required |

Validation is all-or-nothing: any deviation kills the offer, so a malformed
member surfaces as a **failed issuance**, not as a card missing its artwork. The
builders are therefore pure functions with their own tests — every vitest project
is `environment: "node"` with `include: ["src/**/*.test.ts"]`, so a decision
embedded in JSX or an inline literal would be uncovered.

Logo URLs (`files.digitallabor.dev`) are module constants on purpose: they are
brand assets, not per-deployment configuration. The card art is the exception —
it lives on the bank's own origin, so it comes from `BANK_PUBLIC_URL` through
`cardArtUrl` and resolves to `public/card-face.webp`, the same artwork the bank's
own UI draws.

**A rejected display is HTTP 500, not 400.** The body is
`{"error": "invalid request: <json path>: <reason>"}` — the error *code* is
`invalid_request` but the status is 500, so `startIssuance` maps it to
`foundry_unavailable`. Measured 2026-08-19.

**A stale foundry binary silently ignores both fields.** The local server had
been running since before the feature landed and returned `200` for a
deliberately invalid display, which makes a bare 200 worthless as evidence. Check
that the offer *echoes* `credential_offer.display`, or send a known-bad payload
and require a rejection, before believing a green result.

## Formatting

`src/lib/format.ts` — `formatEuroCents`, `formatIban`, `formatBookedAt`,
`formatDayLabel`, `splitEuroCents`.

**Every one of those except `formatIban` takes a trailing `locale: Locale`, and
it is required rather than defaulted** — a default would let a missed call site
keep silently rendering German, which `pnpm typecheck` now catches instead. Each
`Intl` singleton became a `Record<Locale, …>` built once at module scope.
`groupByBookingDay` in `ledger.ts` gained the same trailing parameter.

`de` → **`de-DE`** (`3.487,12 €`), `en` → **`en-IE`** (`€3,487.12`). `en-IE`
rather than `en-US`/`en-GB` because it is the euro-native English locale *and*
it is day-month-first like German, so switching language cannot silently
reinterpret `01/08` as the eighth of January.

This does **not** contradict the old warning about de-DE vs en-IE. That warning
was against *replacing* the bank's de-DE with the merchant's en-IE. Here de-DE
remains and en-IE sits beside it.

`formatIban` is deliberately locale-independent: blocks of four is an IBAN
convention, not a national one.

**A currency assertion must be normalised.** `de-DE` separates the amount from
the `€` with **U+00A0**, not a plain space, which is why `format.test.ts` has a
`normalise()` helper. A raw `toBe("3.487,12 €")` fails. `en-IE` has no space at
all and is unaffected.

## Auth

- Cookie `bank_session`, HttpOnly, signed JWT via `jose` (`src/lib/session.ts`).
- `requireSession` throws `UnauthorizedError`; `withSession` (`src/lib/api.ts`)
  wraps simple route handlers.
- **Dynamic-segment route handlers must use `requireSession` /
  `UnauthorizedError` directly, not `withSession`** — Next passes a `context`
  argument the wrapper does not forward. See
  `src/app/api/cards/[id]/credential/route.ts`.

## `POST /api/payments` — the settlement endpoint

The only endpoint authenticated by API key rather than a session cookie, because
it is the only one called by another service.

- `requireApiKey` (`src/lib/apiKey.ts`) compares `X-API-Key` with
  `timingSafeEqual`. **The length check before it is load-bearing** —
  `timingSafeEqual` throws `RangeError` on mismatched lengths rather than
  returning false.
- `processPayment` (`src/lib/payments.ts`) checks `idempotency_key` **first**. A
  repeat with the same key never re-evaluates credential state or balance; it
  replays the original result.
- The debit and the transaction insert happen in one `db.transaction`. The
  `catch` around it handles a genuine concurrent race losing to the UNIQUE
  index — it re-fetches and returns the winner's result rather than throwing.
  Not unit-tested, because single-threaded vitest cannot produce a real race;
  the sequential case is covered by the top-of-function check.
- Status mapping: `402` insufficient funds, `404` for **both**
  `unknown_credential` and `credential_not_active`. Both are 404 deliberately —
  server-to-server behind a shared secret, so existence-leak concerns do not
  apply, and the merchant maps both to one user-facing message.

Verified behaviour: anna at `348712` paying `4798` → `343914`, and a repeat with
the same `idempotency_key` returns the identical `bank_tx_id`.

## Issuance

- `src/lib/issuance.ts` — `startIssuance`, `refreshIssuanceState`,
  `DPC_CREDENTIAL_TYPE_ID`.
- `mintJoinKey` (`src/lib/credential-id.ts`) generates the value the wallet will
  disclose, in whichever shape the format's claim demands — `dpc_`-prefixed
  base64url for the DPC's `credential_id`, a bare `randomUUID()` for the
  Sparkasse card's `psu_id`.
- The credential row is written **before** foundry is called, so a foundry
  outage leaves a visible `failed` row rather than nothing.
- UI: `AddToWalletButton` **or** `AddToGoogleWalletButton` → `IssuanceDialog`
  (status polling via `useStatusPoll` from `@demo/ui`). QR dark modules are
  `#ff0000`.
- **Issuance prefers the W3C Digital Credentials API** (`openid4vci-v1` via
  `navigator.credentials.create`), falling back to the deep link on touch or
  the QR on desktop. foundry's `POST /admin/issuance/offers` *always* returns
  `dc_api_offer` beside `credential_offer_uri` — two renderings of one offer,
  no transport parameter — so `dcApiOffer` is passed through the API but
  deliberately **not persisted**: the offer is already recorded by
  `foundryTxId`.
- Because both are renderings of the same offer, a DC API failure reveals the
  QR/deep link **immediately**, with no intermediate button. This is
  deliberately asymmetric with the merchant, where the fallback costs a whole
  new foundry verification request.
- A human testing this needs
  `chrome://flags/#web-identity-digital-credentials-creation` enabled. No
  origin-trial token is embedded in the markup, by design.
- **The DC API diagnostics are now catalogued like any other copy**
  (`errors.dcApiUnsupported`, `errors.dcApiCancelled`). This **supersedes** the
  previous rule that they stay English on the grounds that a browser-capability
  failure is a technical signal rather than customer copy. That reasoning
  stopped holding the moment a German customer could meet those strings inside
  an otherwise fully German UI.
- Reading `MESSAGES[locale]` is synchronous, so it does **not** endanger the
  transient-activation rule: no `await` runs between the click handler starting
  and `navigator.credentials.create()`.

## Two card formats

The one girocard, issued as two independent credentials.

- **`startIssuance` takes `credentialTypeId` as a required 5th parameter**
  (before `now`), not a defaulted one. One function with three guarded branches,
  not a sibling like `startAvIssuance`: the formats differ only in the join
  key's shape, the claim set, and whether the display metadata may be attached —
  they share the body, where `startAvIssuance` shares only a shape.
- **The claim sets share nothing.** `src/lib/payment-claims.ts` owns them:
  the DPC gets `{ credential_id, network, card_id }`, `sparkassencard` gets
  `{ sub, masked_iban, psu_id }`. A pure builder with its own tests rather than
  a ternary inside `startIssuance`, and the only place that can assert the
  negatives — no `psu_id` on a DPC, and no full IBAN on either.
- **`psu_id` is the Sparkasse card's join key and lands in the same
  `credential_id` column** the DPC's does, so `processPayment` has one lookup.
  `sub` is minted per issuance, sent, and never persisted.
- **`masked_iban` is `DE** **** 1234`**, its four digits delegated to
  `ibanLastFour` so they cannot drift from the DPC's `card.last_four` — and so
  it inherits that function's throw on a non-numeric tail, inside the `try`,
  degrading to a `failed` row. A fixed mask shape, not one `*` per character:
  a variable-length mask leaks the IBAN's length.
- **`sendsDpcDisplayMetadata` gates the two display arrays.** `sparkassencard`
  sends neither — foundry rejects them for any non-DPC vct, which is a `failed`
  row, not a card missing artwork.
- **The route takes an optional body** `{ credentialTypeId }`. Absent or
  unreadable → the DPC, which keeps a bare POST valid; a named non-payment or
  unknown type → **400 `unknown_credential_type`**, never a silent fallback. All
  four cases verified against the running app.
- **`CardDto.formats`** is the per-format state each button needs; the combined
  `credentialState` is what the card face draws. Without the split, adding
  through one button flips the other's label to "add again" for a credential
  never issued in that format.
- **It is keyed by `CardFormatTypeId`, not `PaymentCredentialTypeId`.** Those
  were the same union until Wero, which is payable but is not a girocard format.
  `listCards` filters on `CARD_FORMAT_TYPE_IDS` for the same reason — and here
  the filter is load-bearing rather than an assertion, because a Wero row *does*
  carry a `card_id` and the card-scoped query would otherwise sweep it in, making
  the girocard's own face read "In wallet".
- **`sparkassencard`'s happy path has never run.** Verified 2026-08-21 against
  the running local foundry with the exact payload the bank sends: **HTTP 400**
  `{"error":"unknown credential_type_id 'sparkassencard'"}`. The row lands
  `failed` with its UUID join key intact — confirmed in the dev database. The
  DPC's path *was* verified end-to-end the same day: HTTP 200, a real
  `openid-credential-offer://` link, display metadata echoed back.
- **The merchant CAN request this format, as of 2026-08-24.** It resolves
  foundry's `payment` / `payment_av` named queries, whose required
  `credential_sets` entry accepts either payment format, and
  `extractCredentialId` reads `psu_id` for a `sparkassencard` answer where it
  reads `credential_id` for a DPC. Both land in this bank's one `credential_id`
  column, so `processPayment` needs no per-format branch. Still unexercised end
  to end: this format's *issuance* is what fails, so no wallet holds one to
  present.

## Age-verification credential

A third credential type, issued to the *person* rather than to a card.

- `src/lib/av-issuance.ts` — `startAvIssuance`, a deliberate **sibling** of
  `startIssuance`, not a branch inside it. The DPC path joins `accounts` for an
  IBAN, derives `card.last_four`, builds two display arrays and can fail
  `card_not_found`; none of that exists here.
- The request is exactly `{"credential_type_id": "av-sparkasse", "claims":
  {"age_over_16": true, "age_over_18": true}}`. Booleans. No birthdate, no name,
  no `credential_id` — an age attestation carrying a birthdate defeats its own
  purpose.
- **`credential_type_id` is `av-sparkasse`, never `eu.europa.ec.av.1`.** That
  second string is the mdoc docType configured on foundry's side. It was a bare
  `av` until the two card formats landed; that value is legacy, still readable
  from the column but never issued and never matched by
  `getAgeCredentialState`.
- **Never send `offer_display` or `credential_response_display` for a non-DPC
  type.** `foundry-issuer/src/create_offer.rs` gates both on
  `ct.vct == "com.emvco.dpc.card"` and rejects them outright, so sending them
  would turn every AV issuance into a `failed` row. Consequence: the wallet's
  rendering of this credential comes entirely from foundry's static `display:`
  config, and `public/av-face.svg` is the bank's *own* UI artwork that the
  wallet never sees.
- `POST /api/credentials/av` uses `withSession` (no dynamic segment, so the
  wrapper's missing `context` forwarding does not bite). The status poll,
  `GET /api/credentials/[id]/status`, and `refreshIssuanceState` are reused
  **verbatim** — they read only `foundryTxId` and `state`, so they were already
  type-agnostic.
- `getAgeCredentialState` (`src/lib/queries.ts`) mirrors `listCards`'
  active-outranks-offered rule, scoped to the user and the type.
  `listCards` now also filters on the payment types explicitly — a row with a
  `card_id` can only be one today, since the age credential has no card, so
  naming them keeps that an assertion rather than an accident.
- **The happy path has never run**, under either type id. No foundry config
  declares `av` or `av-sparkasse` — the local `../foundry/config.yaml` has only
  `pid` and `com.emvco.dpc.card`, though its *named queries* already reference
  `av`. Adding it is the operator's task. Verified 2026-08-20 for `av` and
  2026-08-21 for `av-sparkasse` against a running local foundry: a real `POST`
  answers **HTTP 400** `{"error":"unknown credential_type_id '<id>'"}`,
  `startAvIssuance` returns `foundry_unavailable`, and the row lands `failed`
  with a null card and a null join key. That rejection is the whole of what has
  been exercised.
- **The AV issuance dialog's copy is unverified in a browser, and cannot be
  reached here.** `IssuanceDialog` only mounts once a `session` exists, i.e.
  after a 2xx offer. Its `failureBody` covers a *polling* failure after a
  successful offer — not an offer rejection. On a 502 the tile shows its own
  inline `Angebot konnte nicht erstellt werden.` and no dialog appears. The
  plan for this work expected the dialog's failure panel here; that expectation
  was unreachable by construction.

### Copy (`src/lib/credential-copy.ts`)

`FACE_COPY[locale][kind][faceState]` and `DIALOG_COPY[locale][flavour]` —
**locale is the outermost key** — reached through the
`faceCopy(locale, kind, state)` and `dialogCopy(locale, flavour)` accessors.
Both live in `.ts` because every vitest project is `environment: "node"` with
`include: ["src/**/*.test.ts"]` — a string decided in a `.tsx` file is never
covered.

**Neither map is keyed by credential type id, and that is the point.** They are
keyed by what the copy actually varies with:

- `CredentialKind` (`card | age | wero`) for the face. One tile shows one badge
  for all of its formats, so there is nothing for a format to disagree about.
  Keying by type id would duplicate every card string in both locales and let
  the two drift for no reason a user could observe. `wero` is a kind of its own
  rather than a third `card` format because it is a separate instrument with its
  own tile and its own artwork, so its copy has to name it.
- `IssuanceFlavour` (`card-eudi | card-google | age-eudi | age-google |
  wero-eudi`) for the dialog, because a dialog reading "Add card to EUDI Wallet"
  over a handover started from a Google Wallet badge is a visible defect. For
  the `-google` flavours the *title* names the wallet and the success body
  deliberately does **not** — an OpenID4VCI offer can be answered by any wallet
  on the device, so a title states a knowable intent while a success body would
  state an unknowable outcome. **`wero-eudi` is the exception and may name EUDI
  Wallet in both**, exactly as `card-eudi` does: one handover, from one button.
  There is deliberately no `wero-google` — that would be copy for a button that
  does not exist.
- **No** credential's `active` *face* explain names a wallet. For the card and
  the age credential that is because either of two buttons could have delivered
  it; for Wero, which has only one, it is because the bank still cannot observe
  which app answered the offer.

`CardTile` and `AgeCredentialTile` each map format → flavour through a `FLAVOUR`
lookup rather than a ternary in JSX, so the button pressed and the dialog shown
cannot mismatch. `WeroCredentialTile` has no such map: with one button there is
nothing to look up, so it passes `"wero-eudi"` directly.

**`badgeClass` is NOT part of `CardFaceCopy`.** It was extracted to a
locale-independent `BADGE_CLASS: Record<CardFaceState, string>` in
`credential-copy.ts`: a CSS class has no language, and keeping it inside the
locale-keyed record stored every value twice and let the two locales drift on a
non-linguistic value.

`IssuanceDialog` takes a `copy: IssuanceCopy` prop rather than a noun to
substitute: German gender differs (`die Karte` against `der Altersnachweis`
against a bare neuter `Wero`), so the article and possessive change with the
noun, not just the noun.
`card-state.ts` no longer exports the `STATE_COPY` constant. It exports
**`stateCopy(locale, state)`**, which reads `FACE_COPY[locale].card[state]` —
still by identity, not a parallel copy, and a test asserts that identity so the
two cannot drift.

**The Google Wallet badge is not an `AddToWalletButton` variant.**
`AddToGoogleWalletButton` is a sibling component. That one's contract is a
resolved `label` *string* rendered inside `.btn.btn-primary`; the badge is
Google's artwork (`public/add-to-google-wallet.svg`, served verbatim) whose text
is drawn as SVG paths, so its `label` is the accessible name only — the
`aria-label` and the image's `alt`, catalogued as
`issuance.addToGoogleWallet` so a German screen reader is not read an English
name. Consequences: `walletActionLabel`'s three-way choice has nowhere to render
on the badge, so it has no "add again" state and the tile's badge beside it is
what reports state; and it is sized by height alone (`h-11 w-auto`), because
Google's brand guidelines forbid altering the badge's proportions or colours.
Verified in headless Chrome: natural 199×55, rendered 159×44 — aspect preserved.

The `offered` explanation is **deliberately identical** for all three kinds
(`Bestätigen Sie das Angebot in Ihrer Wallet-App.` / `Confirm the offer in your
wallet app.`) — the instruction genuinely does not depend on what is being
offered. The badges are shared for the same reason: "is it in a wallet" is the
same question whatever the credential, and a third wording would be drift rather
than information. A test pins it **in each language independently**, so neither
language's sharing can drift unnoticed. The plan's original assertion that all
three states differ was unsatisfiable against the plan's own copy table.

The AV face is `.card-object-av`, overriding only `background-image` and
`background-color`. The fallback is `#ff0000`, the artwork's own red, *not*
Sparkasse `--color-primary` (`#EA0016`). Nothing is drawn over it and it gets no
`EuStars`: `.card-stars` is positioned top-right, exactly where the artwork
prints its wordmark.

The Wero face is `.card-object-wero` and overrides one thing more: `color`.
`.card-object` sets `#fff` for the girocard's white-on-red printing and `EuStars`
draws in `currentColor`, so white stars on `#fdf494` would be invisible —
`#1d1c1c` is the wordmark's own tone. That override is what lets this face draw
`.card-stars` where the AV face cannot: `public/wero-face.svg` places the
wordmark left of centre (measured by rasterising it: box x 40→224, y 98→140 of
380×239) so the top-right corner is clear ground.

## Wero credential

A fourth credential type: the bank's account-to-account payment instrument, on
its own tile, offered for the EUDI Wallet **only**.

- **No new route and no new issuance function.** It posts to the card route,
  `POST /api/cards/{id}/credential` with `{"credentialTypeId":"wero"}`. Admitting
  `wero` to `PAYMENT_CREDENTIAL_TYPE_IDS` is the entire mechanism: the route's
  existing parser asks `isPaymentCredentialType`, and `startIssuance`'s non-DPC
  branch already does everything Wero needs. `issuance.ts`, `credential-id.ts`
  and `payment-claims.ts` gained **zero** lines of implementation — only tests
  pinning that Wero lands in those branches, so a future edit to a branch
  condition cannot silently give it the DPC's shape.
- **It reuses the Sparkasse card's claim set**, `{ sub, masked_iban, psu_id }`,
  join key in `psu_id` as a bare `randomUUID()`. That is an **assumption**, not a
  verified contract: no foundry config declares `wero`, so nothing has confirmed
  what its vct wants. Wero being account-to-account makes a masked IBAN plus a
  PSU id the coherent shape, which is the whole of the reasoning.
- **The row carries a card even though no Wero claim mentions one.** Wero is
  drawn on the account, but `processPayment` resolves the account *through* the
  card, so the row needs one. Consequently the tile renders only when the user
  has a card — `cards[0]?.id` in `app/page.tsx` — rather than showing a button
  that could only ever fail.
- **`getWeroCredentialState` has no `formats` map.** The card and age DTOs carry
  one because two buttons can lie to each other about what the other issued.
  There is one button here, so there is nothing to disagree with. Same
  `pickLiveCredential`/`stateOf` rule, applied at one scope instead of two.
- **Never send `offer_display` or `credential_response_display`.** Same hard
  guard as `sparkassencard` and the age credential: `sendsDpcDisplayMetadata` is
  already false for it, and a test pins that per type rather than trusting the
  negation, because the cost of getting it wrong is a `failed` row.
  `public/wero-face.svg` is the bank's own UI artwork that the wallet never sees.
- **The face is `.card-object-wero`, and it overrides `color` as well as the
  image and fallback colour.** `.card-object` sets `color: #fff` and `EuStars`
  draws in `currentColor`, so white stars on `#fdf494` would be invisible;
  `#1d1c1c` is the wordmark's own tone. Unlike `.card-object-av` this face **does**
  draw `.card-stars` — the wordmark is placed left of centre so the top-right
  corner is free. Nothing else is drawn over it: no IBAN, no holder.
- **The heading is a hardcoded `"Wero"`.** A proper noun identical in both
  locales, so catalogueing it would trip `messages.test.ts`' no-leaf-identical-
  across-locales rule — the same reason `Sparkasse` and `EUDI Wallet` are
  hardcoded.
- **The copy is a new `CredentialKind` (`wero`) and one new flavour
  (`wero-eudi`).** There is deliberately no `wero-google`. Its dialog names EUDI
  Wallet in both the title *and* the success body, which the `-google` flavours
  may not — legitimate here for the same reason it is on `card-eudi`: one
  handover, from one button. Its `active` *face* explain still names no wallet,
  because the bank cannot observe which app answered the offer.
- **The happy path has never run.** Verified 2026-08-24 against the running local
  foundry with the exact payload the bank sends: **HTTP 400**
  `{"error":"unknown credential_type_id 'wero'"}`. The local
  `../foundry/config.yaml` declares only `pid`, `com.emvco.dpc.card` and
  `eu.europa.ec.av.1`; the string `wero` does not appear in it. In a real browser
  the click produces the tile's inline `Angebot konnte nicht erstellt werden.`
  and **no dialog**, and the dev database gained a `failed` `wero` row carrying
  `card_anna` and a bare-UUID join key. That rejection is the whole of what has
  been exercised.
- **The merchant cannot request it either**, so even a successful issuance could
  not complete a checkout: foundry's `payment` / `payment_av` named queries
  declare only `dpc` and `sparkassencard`. `processPayment` *would* debit a Wero
  credential — there is a test — but nothing would ever present one.

## i18n

A hand-rolled catalog under `src/lib/i18n/`. No library, no middleware, no URL
segment. Every load-bearing constraint below was a decision, not an accident:

- **`resolveLocale` accepts `"de"` and `"DE"` and `" de "` but NOT `"de-DE"`.**
  Normalisation is deliberately shallow — only our own switcher writes this
  cookie, so a language-tag-shaped value can only be tampering or staleness, and
  falling back to English is the safe answer. Two locales do not justify a
  BCP-47 parser.
- **The `bank_locale` cookie is deliberately NOT `HttpOnly`**, unlike
  `bank_session`. It carries no authority, and making it HttpOnly would force a
  round trip through a route handler just to change a display preference.
- **The switcher works by `document.cookie` + `router.refresh()`, which only
  works because every page is `force-dynamic`.** Making a bank page static would
  silently freeze its language. There is no client-side mirror of the locale
  precisely so a second source of truth cannot disagree with the cookie.
- **Interpolated catalog entries are functions**, not `"{name}"` placeholders,
  so arity and parameter types are checked. The consequence: a catalog entry is
  not serialisable, which is why components receive `locale` and index
  `MESSAGES` themselves rather than being handed resolved copy.
- Both catalogs are declared against one `Messages` interface, so a missing key
  is a **compile** error. `messages.test.ts` adds what the compiler cannot see:
  no empty leaf, no German orthography in the English catalog, and no leaf
  identical across locales. `IDENTICAL_BY_DESIGN` is empty and should stay that
  way — proper nouns are hardcoded in components for exactly that reason.
- **`src/lib/display-metadata.ts` does NOT follow the switch.** Its `LOCALE`
  stays `"en-US"`. It is machine-read by foundry; a wrong value there is a
  `400 invalid_request` and a `failed` issuance row.
- **Reading `cookies()` in the root layout made `/_not-found` dynamic.**
  Measured: it was `○` (static) before this work and is `ƒ` after. No bank route
  is statically prerendered now, which is what keeps a cookie-dependent
  `generateMetadata()` correct.
- **The umlaut grep is not a sufficient check for leftover German.** It cannot
  see `Anmelden`, `Karten`, `Girokonto` or `Im Wallet`, and it *does* match the
  three deliberate umlaut-bearing comments (`layout.tsx`'s Fira Sans rationale,
  and the `CardTile`/`AgeCredentialTile` notes on session-scoped
  `Wird hinzugefügt…`). Exclude comment lines and enumerate capitalised literals
  separately:
  `grep -rn '[äöüßÄÖÜ]' src --include=*.tsx | grep -vE ':[0-9]+:[[:space:]]*(\*|//|/\*)'`

Strings that stay untranslated in both catalogs, and are therefore hardcoded in
components rather than catalogued: `Sparkasse`, `Musterstadt`, `IBAN`,
`EUDI Wallet`, and `anna / demo1234 · ben / demo1234` (that last one is data to
type, not copy).

## Testing

`pnpm test` → **327 tests**. `pnpm typecheck` must also be clean. (It read
`280` before the Wero work, which added 47: +12 in `queries.test.ts`, +10 in
`issuance.test.ts`, +8 in `credential-copy.test.ts`, +7 in
`credential-types.test.ts`, +4 in `payment-claims.test.ts`, +3 in
`payments.test.ts`, +2 in `credential-id.test.ts` and +1 in `schema.test.ts`.
Measured per file, not projected. Several existing tests changed rather than
being added, because assertions that named two payment ids now iterate
`PAYMENT_CREDENTIAL_TYPE_IDS`.) (This line
read `188` before the two-card-format work, which added 55: 11 in the new
`credential-types.test.ts`, 12 in the new `payment-claims.test.ts`, 3 in
`credential-id.test.ts`, 10 in `issuance.test.ts`, 9 in `queries.test.ts`, 3 in
`payments.test.ts`, and +7 net in `credential-copy.test.ts` — rewritten rather
than extended, because both its copy maps were re-keyed. It read `148` before
the i18n work, which added 40: 12 in the new
`src/lib/i18n/locale.test.ts`, 7 in the new `src/lib/i18n/messages.test.ts`,
+10 in `format.test.ts`, +8 in `credential-copy.test.ts`, +2 in
`ledger.test.ts` and +1 in `card-state.test.ts`. It read `87` before the
age-credential work. Measure rather than trusting it; it has been wrong twice.)

`vitest.config.ts` carries an explicit `test.env` block; `env.ts` validates at
import time, so tests fail without it. `apiKey.test.ts` uses
`vi.mock("../env.js", ...)` plus a dynamic `await import` because of that same
import-time validation.
