# AGENTS.md — payment-banking-demo

Instructions for AI agents working in this repository. Read this before making
changes. Per-app specifics live in `apps/bank/AGENTS.md` and
`apps/merchant/AGENTS.md`.

## What this is

A demo proving the EUDI wallet works as a **payment instrument**. Two Next.js
apps talk to an external Rust issuer/verifier (`foundry`, at `../foundry`):

1. `apps/bank` issues an EMVCo Digital Payment Credential (`com.emvco.dpc.card`)
   into a user's wallet.
2. `apps/merchant` requests it at checkout with `transaction_data` amount
   binding, verifies via `foundry`, then debits the bank over REST.
3. The purchase appears in the bank's transaction list.

`credential_id` is the join key between the two apps. The bank is the **sole
owner** of credential state — the merchant never persists it.

## Layout

```
Dockerfile          ONE image containing BOTH apps (see below)
docker-entrypoint.sh  Takes `bank` or `merchant`; anything else exits 64
.dockerignore       Must live here, at the build-context root
apps/bank/          Next.js 15, port 3001, English by default + German switcher
apps/merchant/      Next.js 15, port 3000, English UI
packages/foundry-client/   Typed client for foundry's admin API
packages/ui/        Shared hooks + QrCanvas (NOT shared design tokens)
docs/superpowers/specs/    Design spec — the source of truth
docs/superpowers/plans/    Implementation plans 1-3 (all executed)
tools/cdp/          Headless-Chrome driver for ad hoc browser verification
```

There are no per-app Dockerfiles. `apps/bank/Dockerfile` and
`apps/merchant/Dockerfile` were deleted in favour of the root one.

Reference apps at `../foundry`, `../eudipay-merchant-mock`,
`../banking-frontend`, `../eudipay-frontend` are **visual/UX references only**.
Copy the design, not the architecture.

## Commands

Run from the repo root. `pnpm`, never `npm`.

| Command | Effect |
| --- | --- |
| `pnpm dev` | Both apps in parallel, prefixed output |
| `pnpm check` | `typecheck && test` across all 4 projects — **the gate** |
| `pnpm migrate` | Apply migrations to both databases |
| `pnpm seed` | Reset both databases to fixtures (idempotent, destructive) |
| `pnpm build` | Production build of both apps |

`pnpm check` must be green before you claim work is done. Current baseline:
**546 tests** (327 bank + 177 merchant + 11 foundry-client + 31 ui), measured
2026-08-24.

That was **499** before the Wero work, which added 47, all in `apps/bank`, and
the per-file split was measured rather than projected: +12 in `queries.test.ts`
(the new `getWeroCredentialState` block plus two `listCards` exclusions), +10 in
`issuance.test.ts` (a whole `startIssuance for Wero` describe), +8 in
`credential-copy.test.ts`, +7 in `credential-types.test.ts` (the new
`CARD_FORMAT_TYPE_IDS` block and the widened payment list), +4 in
`payment-claims.test.ts`, +3 in `payments.test.ts`, +2 in
`credential-id.test.ts` and +1 in `schema.test.ts`. Several existing tests
changed rather than being added — `isPaymentCredentialType`'s list assertion,
`isAgeCredentialType`'s "rejects both payment formats", and the
never-discloses-a-full-IBAN and unique-join-key loops, all of which now iterate
`PAYMENT_CREDENTIAL_TYPE_IDS` instead of naming two ids. No plan; the work was a
bounded request.

That was **489** before the `payment`/`payment_av` named-query work, which added
10, all in `apps/merchant`: +8 net in `checks.test.ts` and +2 in
`settle.test.ts` (a Sparkassen-Card settle, alone and paired with an age
attestation). `checks.test.ts` gained more than 8 `it()` blocks but lost some
too — several existing single-shape tests became two-format assertions inside
one block rather than new blocks. Every other affected suite changed without
growing: `dcql.test.ts`, `payment-sessions.test.ts` and
`checkout-session.test.ts` only had their expected strings re-keyed. No plan;
the work was a bounded request whose premise ("a rename") turned out to be
wrong.

That was **460** before the two-age-format work, which added 29, all in
`apps/bank`: +8 in `credential-types.test.ts` (the new `av` id and
`isAgeCredentialType`), +9 in `av-issuance.test.ts`, +8 in `queries.test.ts`
(a `getAgeCredentialState per format` block), and only +4 net in
`credential-copy.test.ts` — that file gained seven `age-google` assertions but
lost three, because two existing single-kind tests became loops over both kinds
once the age copy stopped naming a wallet, and the age-dialog tests were re-keyed
rather than duplicated. Existing tests changed rather than being added: every
`getAgeCredentialState` DTO assertion gained `formats`, and the age active
`explain` no longer names EUDI Wallet. No plan; the work was a bounded request.

That was **405** before the two-card-format work, which added 55, all in
`apps/bank`: 11 in the new `credential-types.test.ts`, 12 in the new
`payment-claims.test.ts`, 3 in `credential-id.test.ts` (`mintJoinKey`), 10 in
`issuance.test.ts` (a whole `sparkassencard` describe block), 9 in
`queries.test.ts` (a `listCards per format` block), 3 in `payments.test.ts`, and
+7 net in `credential-copy.test.ts`, which was rewritten rather than extended
because both its copy maps were re-keyed. Two existing tests changed rather than
being added: the verbatim English active-`explain` assertion in
`card-state.test.ts` and its twin in `credential-copy.test.ts`, both because the
card's active copy stopped naming a specific wallet. No plan; the work was a
bounded request.

That was **397** before the re-issuance work, which added 8, all in `apps/bank`:
5 in `credential-copy.test.ts` (4 for the new `walletActionLabel`, 1 asserting
the active-state `explain` invites a re-add) and 3 in `queries.test.ts` (2 for
`listCards`, 1 for `getAgeCredentialState`). Two existing tests changed rather
than being added: the verbatim English active-`explain` assertion in
`card-state.test.ts`, and — in both query suites — the "prefers the newest
non-failed row" tests, which asserted exactly the behaviour that produced the
second defect. No plan; the work was a reported bug.

That was **357** before the bank i18n work, which added 40, all in `apps/bank`:
12 in the new `src/lib/i18n/locale.test.ts`, 7 in the new
`src/lib/i18n/messages.test.ts`, and — because the existing suites gained a
second locale rather than new files — +10 in `format.test.ts`, +8 in
`credential-copy.test.ts`, +2 in `ledger.test.ts` and +1 in
`card-state.test.ts`. Its plan never projected a total, only per-task running
subtotals for Tasks 1-2; the rest was measured.

That was **329** before the age-verification-credential work, which added 28,
all in `apps/bank`: 5 in `src/db/schema.test.ts`, 2 in `payments.test.ts`, 7 in
`queries.test.ts`, 7 in the new `av-issuance.test.ts`, and 7 in the new
`credential-copy.test.ts`. Its plan projected 356 and was off by one — its
Task 6 specified a test asserting the two credentials' `explain` string differs
in all three face states, which was unsatisfiable against the plan's own copy
table (both types share the `offered` string deliberately), so that one test
became two. Measure.

That was **305** before the DPC display-metadata work, which added 24: 19 in
`apps/bank/src/lib/display-metadata.test.ts`, 2 seed-invariant tests, 2 issuance
tests, and 1 forwarding test in `packages/foundry-client`.

That was **295** before the card-artwork / session-scoped-issuing work, which
added 10 (all in `apps/bank/src/lib/card-state.test.ts`).

That was **253** before the payment-sheet / 18+-marking work, which added 42.
That plan projected 294. It was off by one for the ordinary reason: its Task 4
specifies 15 `it()` blocks while its running total assumed 14. Every subsequent
task's projection inherited the error. Measure.

That was **218** before the named-query / age-verification work, which added 35.

That was **186** before the DC API transport work, which added 32. The plan for
that work projected 210 and was simply wrong — its per-task arithmetic did not
match the number of `it()` blocks actually written. Measure.

That number was **162** for most of this project's life, and a stale `162` is
still quoted in the Plan 3 document. The difference is not drift: 20 of those
tests arrived with in-flight UI work that sat uncommitted in the working tree
for a long stretch, and 4 are the `seedIfEmpty` tests. If a count disagrees with
yours, measure — do not trust a number written in a plan.

## Hard-won constraints

Every item below was discovered by something breaking. Do not "clean up" any of
them without reading the linked reasoning first.

### Credentials and credential types

- **Display metadata is DPC-only.** `foundry-issuer/src/create_offer.rs` gates
  both `offer_display` and `credential_response_display` on
  `ct.vct == "com.emvco.dpc.card"` and *rejects* them for every other credential
  type. A non-DPC credential's wallet appearance can therefore come only from
  foundry's static `display:` config — the issuer cannot influence it. Sending
  the bank's card display metadata on an `av-sparkasse` or `sparkassencard`
  offer would turn every issuance into a `failed` row. `sendsDpcDisplayMetadata`
  in `lib/credential-types.ts` is the guard, and it is a named predicate with
  its own test rather than an inline comparison precisely because the failure is
  a `failed` row and not a card missing its artwork.

- **There are THREE payment credentials but only TWO girocard formats, and
  conflating those two questions is a visible defect.** `CARD_FORMAT_TYPE_IDS`
  (`com.emvco.dpc.card`, `sparkassencard`) is what the girocard tile and
  `CardDto.formats` read; `PAYMENT_CREDENTIAL_TYPE_IDS` is that list plus `wero`
  and is what the debit guard and the card route's parser read. They were the
  same list while the girocard was the only instrument. Scoping `listCards` to
  the wider one makes the *girocard's* face read "In wallet" because a Wero
  credential exists — and unlike an age credential, a Wero row genuinely carries
  a `card_id`, so the card-scoped query really would sweep it in. Verified in a
  real browser: with an `active` Wero row present the girocard tile still reads
  `Nicht im Wallet` with no stars and both its buttons intact.

- **Wero is a payment credential with ONE button, and it reuses the Sparkasse
  card's claim set.** `wero` needed no new route, no new issuance function and no
  new claim builder: admitting it to `PAYMENT_CREDENTIAL_TYPE_IDS` is the whole
  of what makes `POST /api/cards/{id}/credential` accept it, and
  `startIssuance`'s existing non-DPC branch already mints a bare-UUID join key,
  builds `{ sub, masked_iban, psu_id }` and suppresses the display metadata.
  That claim set is an **assumption** — no foundry config declares `wero`, so
  nothing has confirmed what its vct actually wants. It is offered for the EUDI
  Wallet only, which is why `WeroCredentialTile` has no `formats` record and no
  `FLAVOUR` map: those exist on the other two tiles because two buttons can lie
  to each other about what the other issued, and there is no second button here.

- **`.card-object-wero`'s overrides are corrections, not decoration.**
  `.card-object` is tuned for white printing on dark red artwork, and Wero's face
  is a flat `#fdf494` ground, so four of its declarations are wrong here rather
  than merely off-key: `color: #fff` (invisible type), the `box-shadow`'s
  `color-mix(--color-primary 70%, black)` (a **red** cast under a yellow card —
  Sparkasse red is the girocard's colour, not this instrument's), `.card-label`'s
  `rgb(255 255 255 / 0.62)` (invisible, not faint) and `.card-iban`'s
  `text-shadow` (smears dark glyphs on a flat ground). The neutral shadow reuses
  `rgb(16 24 40)`, the ink the inherited contact shadow already uses, so the two
  layers agree rather than merely both being dark.

- **A card face carries EU stars OR a brand mark, never both.** The corner fits
  one. The girocard draws `.card-stars` there; Wero draws `.card-brand` — its
  wordmark, `public/wero-logo.svg`, an `<img>` served verbatim because the file
  carries two `<linearGradient>` ids that inlining would expose to collision. The
  consequence is deliberate: a brand mark is present in *every* state, so Wero's
  `active` is reported by the badge beside the tile alone, exactly as the age
  credential's is. The age face has neither — its artwork prints its own wordmark
  in that same corner.

- **Wero's ground is `#fdf494` and nothing else, which takes TWO declarations
  beyond the colour.** Both were defects reported from a browser, not
  theory. `background-image: none` is required: omitting the property does not
  clear it, and `.card-object` sets `url("/card-face.webp")`, so the girocard's
  photograph shows through under the yellow. And
  `.card-object-wero[data-state="none"]` must set `filter: none`, because the
  shared `saturate(0.82)` sits back a *photograph* on the girocard but simply
  dulls a flat brand colour here. The affordance that filter provided is carried
  by the badge and the button copy instead — where the age face already leaves
  it. There is no `wero-face.svg`: the deleted asset's wordmark would only have
  printed the mark twice.

- **The bank dashboard's first section is *Payments*, not *Cards*.** It holds the
  girocard tiles and the Wero tile; *Credentials* holds the age attestation
  alone. The catalog key was **renamed** `dashboard.cards` → `dashboard.payments`
  rather than re-worded in place — a key called `cards` holding "Payments" is the
  drift this catalog is strict about. en `Payments`, de `Zahlungsmittel`.

- **The girocard is issued in TWO payment formats, and they share no claims.**
  `com.emvco.dpc.card` declares `{ credential_id, network, card_id }`;
  `sparkassencard` (vct `https://creds.digitallabor.dev/vct/sparkassencard`)
  declares `{ sub, masked_iban, psu_id }`. Not a superset, not a rename. Both
  are payable, so `processPayment` asks `isPaymentCredentialType` rather than
  naming one type. `lib/payment-claims.ts` owns the per-format claim shape and
  is the only place that can assert the negatives — that a DPC never carries a
  `psu_id`, and that neither format ever discloses a full IBAN.

- **`psu_id` is the Sparkasse card's join key, and it lands in the same
  `credential_id` column.** The DPC spells that role `credential_id`; there is
  one lookup in `processPayment` either way, which is the whole reason the
  column is not per-format. `mintJoinKey` picks the shape: the DPC keeps the
  `dpc_`-prefixed base64url form, `sparkassencard` gets a bare `randomUUID()`
  because its vct declares a UUID and a prefix there would be malformed. `sub`
  is minted per issuance, sent, and never persisted — nothing resolves a
  credential by it.

- **`masked_iban` is `DE** **** 1234`, and its four digits come from
  `ibanLastFour`.** Not a second `slice`: the Sparkasse card's `masked_iban` and
  the DPC's `card.last_four` must show the same digits, so they share one tested
  derivation — which also means `maskIban` inherits its throw-on-non-numeric-tail
  guard. The mask is a fixed shape rather than one `*` per hidden character; a
  variable-length mask would leak the IBAN's length, which identifies the
  issuing country's format.

- **The card tile's two buttons need per-format state, or they lie.**
  `CardDto.formats` is a `Record<CardFormatTypeId, CardCredentialState>`
  alongside the combined `credentialState` — `CardFormatTypeId`, not
  `PaymentCredentialTypeId`, since Wero joined the latter. Without it, adding the card through
  one button flips the other's label to "add again" for a credential that was
  never issued in that format. The combined state is what draws the EU stars —
  the card is in a wallet, and the face has no opinion about which format got it
  there. Both come from `pickLiveCredential` applied at two scopes rather than
  from a second rule for combining per-format answers.

- **`credential_type_id` has NO CHECK constraint, so widening it needs no
  migration.** The column is plain `text`; the drizzle `enum:` is a TypeScript
  claim about the data, not a database one. Verified against
  `0001_even_bloodscream.sql`. Adding `sparkassencard`, `av-sparkasse` and later
  `wero` was a one-line schema edit and zero SQL each time.

- **The copy maps are keyed by what the copy varies with, NOT by credential type
  id.** `FACE_COPY` is keyed by `CredentialKind` (`card | age | wero`) because
  one tile shows one badge for all of its formats; `DIALOG_COPY` is keyed by
  `IssuanceFlavour`
  (`card-eudi | card-google | age-eudi | age-google | wero-eudi`) because
  a dialog reading "Add card to EUDI Wallet" over a handover started from a
  Google Wallet badge is a visible defect. Keying either by type id would
  duplicate every string in both locales and let the formats drift. `wero` is a
  *kind* rather than a third `card` format precisely because its copy has to name
  it, and there is no `wero-google` flavour — that would be copy for a button
  that does not exist. **No** credential's `active` explain names a wallet: the
  card's and the age credential's because each can arrive through either of its
  tile's two buttons, and Wero's — which has only one button, so naming EUDI
  Wallet there would be defensible — because an OpenID4VCI offer is answered by
  whichever wallet the device hands it to, and the bank never learns which.

- **The Google Wallet badge has no "add again" state.** It is Google's artwork
  and its text is drawn as SVG paths, so `walletActionLabel`'s three-way choice
  has nowhere to render. Both tiles carry one, so both have a format whose
  button cannot report its own state; the tile's badge beside it is what does.
  `AddToGoogleWalletButton` is a sibling of
  `AddToWalletButton` rather than a `variant` on it: that component's contract
  is a resolved `label` *string* inside `.btn.btn-primary`, and this one's
  `label` is the accessible name only (`aria-label` plus the image's `alt`).
  Sized by height alone (`h-11 w-auto`) — Google's brand guidelines forbid
  altering the badge's proportions or colours.

- **A `credentials` row needs neither a card nor a `credential_id`.**
  `credentialTypeId`
  (`com.emvco.dpc.card | sparkassencard | wero | av | av-sparkasse`)
  is the discriminator and defaults to the DPC type, so an insert that forgets
  it silently becomes a payment credential. `processPayment` refuses anything
  that is not a *payment* row with a card — three independent ways, one of which
  is that SQL never matches `credential_id = <string>` against NULL. That guard
  is `isPaymentCredentialType`, not a comparison against one id: widening it to
  admit `sparkassencard` and then `wero` was the point, and both age formats are
  still refused even though the column holds them.

- **The age credential is issued in TWO formats, and they share ALL their
  claims.** `av-sparkasse` is the EUDI button's format; `av` is the Google
  Wallet badge's. Neither is `eu.europa.ec.av.1` — that is the mdoc docType
  configured on foundry's side, not an id the admin API takes. Unlike the two
  card formats, which share no claims at all, these two send byte-identical
  `AV_CLAIMS`: they are one attestation in two wrappers, which is why there is
  no age equivalent of `payment-claims.ts` and why `startAvIssuance` takes the
  type as a parameter rather than branching on it. `isAgeCredentialType` is the
  predicate, deliberately disjoint from `isPaymentCredentialType` — an id
  answering true to both would let an age attestation authorize a debit.

- **`av` is no longer a legacy spelling — it is a live format.** It used to be
  the pre-`av-sparkasse` id that nothing issued and `getAgeCredentialState`
  ignored, so a leftover row read as "not in wallet". It now resolves as the
  Google Wallet format, so a **pre-existing `av` row reads as in-wallet**. That
  is a visible behaviour change on old data, and it is correct: the row does
  describe an age credential in a wallet.

- **The age tile's two buttons need per-format state, for the same reason the
  card's do.** `AgeCredentialDto.formats` is a
  `Record<AgeCredentialTypeId, CardCredentialState>` alongside the combined
  `state`. Both come from `pickLiveCredential`/`stateOf` applied at two scopes,
  exactly as `listCards` does it — not from a second rule for combining
  per-format answers. The combined state is what the badge and the face draw:
  the credential is in a wallet, and the face has no opinion about which one.
  That is also why the age tile's `active` explain stopped naming EUDI Wallet.

- **Issuance is repeatable, and an `active` row outranks a newer `offered`
  one.** Nothing behind the UI ever forbade a second issuance — neither route
  guards on state, and both `startIssuance` and `startAvIssuance` just insert
  another row — so the bank offers "add again" on a credential that is already
  in the wallet. A credential's formats are independent under this rule: neither
  supersedes the other, and `CardDto.formats` / `AgeCredentialDto.formats` are
  what keep their buttons from claiming credit for each other's work. `pickLiveCredential` in `lib/queries.ts` is what makes that
  safe: the plain "newest non-failed row wins" rule it replaced meant one
  abandoned re-issue wrote an `offered` row that outranked the `active` one
  *forever* (nothing in this project clears an offered row), and the tile then
  read "Not in wallet" for a credential demonstrably in the wallet. Observed in
  a real browser. Newest still wins within a state, so a completed re-issue
  does supersede its predecessor.

- **The button label is a decision, so it lives in `.ts`.**
  `walletActionLabel` (`lib/credential-copy.ts`) chooses between "add",
  "add again" and "preparing"; `AddToWalletButton` takes a resolved `label`
  string and has no locale. Same reason as `cardFaceState`: vitest is
  `environment: "node"` with `include: ["src/**/*.test.ts"]`, so a ternary in a
  `.tsx` file is untested. It also means the card, age and Wero tiles cannot
  disagree about the wording. It governs the EUDI button only — see the Google
  Wallet badge bullet above for why the badge has no label to choose.

- **Note the local foundry config's *named queries* already reference `av`**,
  which makes its absence as a *credential type* easy to misread as present.
  They are different registries; a named query naming `av` does not declare it.

- **None of `sparkassencard`, `wero`, `av-sparkasse` or `av` is declared by any
  foundry config.** Verified 2026-08-21 for the first, and 2026-08-24 for all
  four, against the running local foundry with the exact payload the bank sends:
  each is HTTP **400**, `{"error":"unknown credential_type_id '<id>'"}`. The
  local `../foundry/config.yaml` declares exactly three credential types — `pid`,
  `com.emvco.dpc.card` and `eu.europa.ec.av.1` — and the string `wero` does not
  appear in it at all. So the bank's Sparkasse-card, Wero and both age happy
  paths have never run, and a real attempt degrades to a visible `failed` row —
  confirmed in the dev database, where clicking each of the age tile's two
  buttons wrote one `failed` row of the matching type, and clicking Wero's one
  button wrote a `failed` `wero` row carrying `card_anna` and a bare-UUID join
  key. In the browser that surfaces as the tile's own inline
  `Angebot konnte nicht erstellt werden.` with **no dialog** — `IssuanceDialog`
  only mounts once a 2xx offer exists. `com.emvco.dpc.card` IS declared and its issuance was
  verified end-to-end: HTTP 200, a real `openid-credential-offer://` deep link,
  and the display metadata echoed back in `credential_offer.display`. Adding the
  four missing types is the operator's task.

- **The merchant now accepts EITHER payment format, and the join key is
  per-format.** `selectNamedQuery` resolves foundry's `payment` / `payment_av`
  named queries (2026-08-24, replacing `dpc` / `dpc_av`). Each declares both
  payment credentials as the two options of one required `credential_sets`
  entry, so a holder of either can pay, and `transaction_data.credential_ids` is
  `["dpc", "sparkassencard"]` — naming one would leave the amount unbound
  whenever the wallet answered with the other. `extractCredentialId`
  (`apps/merchant/src/lib/checks.ts`) reads `credential_id` from a `dpc` answer
  and `psu_id` from a `sparkassencard` one: a **map keyed by query id, never a
  fallback chain**, because the two formats share no claims and a claim-name
  collision must not decide who gets debited. `passedTransactionDataBinding` and
  `extractCredentialId` resolve **one** payment credential through a single
  shared helper, so the amount can never be bound to one card while the debit is
  keyed to another — which also means there is no "try the next payment
  credential" fallback when the resolved one's binding check failed.

- **The merchant CANNOT request `wero`, so a Wero credential cannot actually
  pay.** The bank would debit one — `isPaymentCredentialType` admits it and
  `processPayment` has a test proving the debit — but foundry's `payment` /
  `payment_av` named queries declare only `dpc` and `sparkassencard`, so no
  wallet is ever asked for a Wero credential and `extractCredentialId` has no
  entry for one. Wero is therefore issuance-complete and settlement-ready but
  unreachable end to end, and the missing piece is a **foundry config** change
  (declare the credential type, then add it to the named queries'
  `credential_sets` and to `transaction_data.credential_ids`), not merchant
  code. Adding it to `extractCredentialId` before the query declares it would be
  dead code keyed to a query id nothing answers.

- **`payment_av` accepts either AGE format too, and their claim nestings
  differ.** `av_sdjwt` is a `dc+sd-jwt` VC whose `age_over_18` lands flat, like
  the DPC's claims; `av_mdoc` is an mdoc whose element is nested under
  `eu.europa.ec.av.1`. `passedAgeVerification` pins each format to its own
  shape rather than accepting both shapes for both formats — a wallet that put
  the element in the wrong place must fail. Nothing answers the retired `av`
  query id, so a verdict stored under `dpc_av` cannot clear the new gate.

- **Read `drizzle-kit generate`'s output before committing it.** For the `0001`
  migration it emitted a table rebuild whose `INSERT … SELECT` listed the
  newly-added `credential_type_id` on both sides, selecting a column the old
  table does not have. That is unrunnable (`no such column`) and broke every
  test in `schema.test.ts`, not just the new ones. The committed SQL is
  hand-edited to omit it so the column DEFAULT backfills.

### Build and tooling

- **Every Next app's `next.config.ts` must set**
  `config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] }` in its
  `webpack()` hook. Local imports are written `./foo.js` for a `./foo.ts` file
  (correct Node ESM form, needed so vitest and tsc agree). Next's webpack
  resolver does not handle that, and every such import fails with "Module not
  found" without it.

- **Turbopack does NOT resolve that mapping natively.** This file claimed it did
  until 2026-08-20; the claim was false. `next dev --turbopack` compiles both
  instrumentation targets cleanly and then dies at *runtime* with `Cannot find
  module './env.js'` from instrumentation's dynamic import, hitting the
  `process.exit(1)` path — `extensionAlias` is webpack-only and has no
  Turbopack equivalent configured here. Measured on Next 15.5.22. Do not reach
  for `--turbopack` as a workaround for anything.

- **Next compiles `src/instrumentation.ts` for the EDGE runtime too**, always,
  even though neither app has middleware or an edge route, so that bundle is
  never executed. Its build failure is not harmless: in dev a stored compiler
  error is served for **every** route, which is what made `pnpm dev` answer 500
  everywhere while the node server had in fact booted and seeded fine. Each
  `next.config.ts` therefore cuts the edge graph at our own db boundary:
  `if (nextRuntime === "edge")` push a
  `webpack.IgnorePlugin({ resourceRegExp: /^\.\/db\/(index|seed)\.js$/ })`
  (the `webpack` instance comes from the hook's second argument — do not add a
  bare `import webpack`, it is not a declared dependency). Stubbing the node
  builtins underneath instead is unbounded whack-a-mole: hiding `fs` merely
  promotes `node:crypto` (via `src/lib/password.ts` ← `src/db/seed.ts`) to the
  next failure. `register()` pairs this with an `=== "edge"` early return so
  nothing calls into the empty stubs.

- **`better-sqlite3` must be `^13.0.3`.** The `^11.x` line fails to compile
  against current Node's V8 (`GetPrototype`, `Context::GetIsolate`,
  `PropertyCallbackInfo::This` were removed).

- **There is ONE Dockerfile, at the repo root, producing ONE image for both
  apps.** The entrypoint takes `bank` or `merchant`. Its `pnpm install` runs
  *after* `COPY . .` on purpose: `.npmrc` sets `node-linker=hoisted`, so
  third-party packages hoist to the root `node_modules` but the `@demo/*`
  workspace links exist only in `apps/<app>/node_modules` (verified:
  `node_modules/@demo` does not exist). A `deps` stage that copies just
  `/repo/node_modules` drops them and `next build` cannot resolve `@demo/ui`.
  Do not "optimise" this back into a separate deps stage.

- **Adding a no-default env var means editing the Dockerfile's build-stage
  `ENV` block too.** `env.ts` validates at import time and `**/.env.local` is
  dockerignored, so that block is the only thing satisfying required variables
  during `next build`. Miss one and the build fails *remotely from its cause* —
  `MERCHANT_PAYEE_ID` surfaced as `Failed to collect configuration for
  /success` / `Failed to collect page data for /api/payment-sessions`, with the
  real reason only inside `[cause]`. It is not a `build-job.yml` problem and no
  build arg is involved. Measured: the placeholders stay confined to the build
  stage and are absent from the runtime image's config, so the deployment
  manifest must supply the real value separately — a pod missing it exits 1 at
  boot (`CrashLoopBackOff`), it does not degrade to 500s.

- **`.dockerignore` must be at the repo root.** Builds use the root as context,
  and Docker only honours `<context>/.dockerignore`. Two per-app `.dockerignore`
  files previously sat at paths Docker never reads and were silently inert,
  which let the host's `node_modules` — including an `arm64` `better-sqlite3`
  addon — leak into the build. That also masked the deps-stage bug above, so the
  earlier "verified in a real podman container" claim for those Dockerfiles only
  held by accident.

- **`docker-entrypoint.sh` defaults `PORT` and `DATABASE_PATH` per app.**
  `env.ts` defaults `DATABASE_PATH` to a *relative* `./data/<app>.db`, which
  resolves under the app directory — owned by root, unwritable by `USER 1000`,
  so both apps exited 1 at boot with `EACCES` until the entrypoint pointed them
  at `/data`. `PORT` is defaulted for the same class of reason: Next uses 3000
  for both apps, so `podman run -p 3001:3001 <image> bank` would otherwise
  listen on the wrong port and every request would hang. Explicit values win.

- **Root `package.json` needs `pnpm.onlyBuiltDependencies: ["better-sqlite3"]`.**
  pnpm 10 blocks native postinstall scripts by default.

- **App `package.json` files deliberately have NO `"type": "module"`.** Next's
  generated standalone `server.js` is CommonJS and ships alongside that same
  manifest; adding it crashes the container at boot. The *root* package.json
  does have it — that is correct and different.

- **`instrumentation.ts` must live under `src/`, not the package root**, for the
  `src/app` layout. Next computes the hook root as the parent of `app/`. A file
  at the package root is silently ignored with no build warning.

- **That hook must call `process.exit(1)` itself** on env-validation failure. A
  bare `throw` is not reliably fatal — it can degrade to permanent per-request
  500s without the process ever exiting, which is a far weaker signal for an
  orchestrator than a hard crash.

- **TypeScript is strict with `noUnusedLocals` and `noUnusedParameters`.** An
  intentionally-unused parameter must be prefixed `_` (see
  `refreshPaymentSessionState`'s `_now`).

- **`vitest.config.ts` needs an explicit `test.env` block** in each app —
  `env.ts` validates at import time, so tests fail without it.

- **A `next/font` variable must not be named after a Tailwind `@theme` token.**
  Already true of `--font-display-face`; now also of `--font-eudipay-face`.
  `@theme` writes its tokens to `:root`, the same element `next/font` writes to,
  so a token defined as `var(--font-eudipay)` referring to itself resolves to
  nothing.

### The payment sheet

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
  Every vitest project is `environment: "node"` with
  `include: ["src/**/*.test.ts"]`, so a `.tsx` file is never covered. Branching
  inside the component is how a spacing defect in one state stayed invisible
  from the others.

- **`.eudipay-*` classes own their padding and vertical rhythm**, unlike every
  other component class in `globals.css`. The sheet has one instance and its
  rhythm is part of the design; the old split between a stylesheet and `mt-*`
  utilities on inline-level buttons is what produced the reported spacing bugs.
  The sheet also carries the file's only `box-shadow`, on purpose.

- **The `18+` glyph is `18+`, never `+18`**, and it is drawn in Larder's palette
  rather than EudiPay's — an age restriction is the grocer's obligation. Its
  source of truth is `AGE_RESTRICTED_PRODUCT_IDS` in `lib/dcql.ts`, read through
  `isAgeRestricted`, which `selectNamedQuery` also calls so the shelf tag and the
  `payment` → `payment_av` escalation cannot disagree. There is no `products`
  column.

### The bank's card face

- **The card face is the real artwork, `apps/bank/public/card-face.webp`.** It
  already contains the logo, wordmark, chip, contactless mark and network mark,
  so `.card-chip`, `.card-network` and the on-card `SparkasseLogo` were deleted
  rather than layered over it. Only the IBAN and the holder are drawn on top.
  `background-color: var(--color-primary)` sits behind it deliberately, so a
  missing asset degrades to Sparkasse red instead of a hole.

- **`next build`'s standalone output does NOT include `public/`.** The bank had
  no `public/` at all until this work, so the Dockerfile only copied the
  merchant's; the bank's needs its own `COPY` line or the artwork 404s in every
  container and the card silently falls back to that flat red.

- **`SparkasseLogo` is portrait (354.126 / 460.684 = 0.769), not square.** Call
  sites must set height only (`h-8 w-auto`); `h-8 w-8` stretches the glyph
  horizontally by ~30%. Measured 25×32 px in the header.

- **"Wird hinzugefügt…" is session-scoped, never read back from the database.**
  Nothing in this project ever clears an `offered` credential row — there is no
  revocation and expiry does not change the row — so a single abandoned attempt
  used to pin the badge and the infinite `card-sheen` animation on forever. The
  decision lives in `lib/card-state.ts` (`cardFaceState`), not in JSX, because
  vitest is `environment: "node"` with `include: ["src/**/*.test.ts"]` and a
  `.tsx` file is never covered. The accepted cost: a genuinely open offer
  becomes invisible after a reload.

### Running ad hoc scripts

- **Use a scratch `.ts` file plus `pnpm exec tsx`.** Not
  `node --experimental-strip-types` (it does not apply the `./foo.js` →
  `./foo.ts` mapping and dies with `ERR_MODULE_NOT_FOUND` on the *transitive*
  `../env.js` import), and not `tsx -e` (evaluates as CJS, chokes on `import`):

  ```bash
  cd apps/merchant
  cat > scratch.ts <<'TS'
  import { createDb } from "./src/db/index.js";
  // ...
  TS
  pnpm exec tsx --env-file-if-exists=.env.local scratch.ts
  rm -f scratch.ts
  ```

- **`tsx` does not auto-load `.env.local`** — hence
  `--env-file-if-exists=.env.local` in every db script.

### Environment notes

- **`pnpm dev` works again as of 2026-08-20.** It used to return HTTP 500 on
  every route with `Module not found: Can't resolve 'fs'`, trace
  `better-sqlite3 → src/db/index.ts → src/instrumentation.ts`. The diagnosis
  recorded here was partly wrong: the node runtime was never broken — it booted,
  seeded, and reached `✓ Ready`. The 500s came from the *edge* compilation of
  the same file, whose error dev serves for every route. See the edge-runtime
  bullet under "Build and tooling" for the fix. An early return alone genuinely
  does not fix it (webpack still traces the dynamic import); it needs the
  `IgnorePlugin` cut as well. Verified: both dev servers answer
  `/api/health` 200, bank `/login` 200, bank `/` 307, merchant `/` and
  `/checkout` 200 with real rendered markup, seeding still runs at boot, and
  `pnpm build` plus `pnpm check` (357) stay green.
- **Use `podman`, not `docker`** — docker is not installed here. Same Dockerfile
  syntax. Container-to-host is `host.containers.internal` (podman) vs
  `host.docker.internal` (docker).
- **Never verify a container with a bare foreground `podman run`** — a Next
  standalone server can hang indefinitely rather than exiting. Use
  `podman run -d` then `podman inspect` / `podman logs`.
- **The `timeout` command is not available** in this shell.
- **Browser verification**: `tools/cdp/cdp.mjs` drives real headless Chrome. Use
  it instead of asserting on server-rendered HTML when checking interaction.

## Conventions

- **All money is integer cents.** Never a float. Column names end in `_cents`.
  The one exception is `transaction_data.amount`, which must be a plain decimal
  string — convert at that boundary only, with `toFixed`, never `Intl` (it is
  machine-read by foundry and must never localize).
- **No hardcoded URLs or secrets.** Everything comes from zod-validated env. A
  missing secret crashes the process at boot with a named error.
- **Design tokens are deliberately NOT shared** between the apps. The bank is
  Sparkasse-styled and **bilingual** (English by default, German via a
  switcher); the merchant is its own brand and English-only. Only behaviour
  (`packages/ui`) is shared. The bank's locale machinery is likewise **not**
  shared — it lives in `apps/bank/src/lib/i18n/`, because the merchant has no
  second language to switch to.
- **No revocation anywhere.** foundry exposes no revoke endpoint; credentials
  expire on their 12-hour lifetime.
- **TDD.** Write the failing test, run it, confirm it fails for the right
  reason, then implement. Both plans were executed this way.
- **Verify against real services, not mocks**, wherever it is possible. Unit
  tests may stub `fetch`; task-completion claims should rest on a real HTTP
  call, a real container, or a real browser.
- **Commits** use conventional prefixes (`feat(scope):`, `fix:`, `chore:`,
  `docs:`). Commit messages state what was *verified*, and state plainly what
  was not.

### DC API

- **`packages/ui/src/dcApi.ts` injects browser globals on purpose.** All four
  vitest projects run `environment: "node"` with `include: ["src/**/*.test.ts"]`
  — there is no jsdom and `.tsx` is not matched. Reading `window` at module
  scope would make detection untestable. Keep decisions in `.ts`, rendering in
  `.tsx`. `selectTransport` in the merchant exists for exactly this reason.
- **No `await` may execute between a click handler starting and
  `navigator.credentials.get()` / `.create()`.** Chrome consumes the click's
  transient activation. This is why both apps have the DC API payload in the
  component as a prop before the click, rather than fetching it in the handler.
- **The `create` gate is lenient, the `get` gate is strict** —
  `supportsDcApi` skips `userAgentAllowsProtocol` for `create`. Measured on
  HeadlessChrome 151: `userAgentAllowsProtocol` exists and returns `true` for
  **both** `openid4vp-v1-unsigned` and `openid4vci-v1`, so on that build the
  leniency is currently doing no work. It is kept because `openid4vci-v1` is a
  Chrome origin-trial identifier behind
  `chrome://flags/#web-identity-digital-credentials-creation`, not a shipped
  protocol, and a browser that can issue may still answer `false`.
- **`useDcApiSupport` returning `null` is not `false`.** It means "not yet
  known". Rendering the QR fallback on `null` flashes a QR on Android.
- **A `dc_api` session can never be re-rendered as a QR.** It is bound to
  `response_mode: dc_api.jwt` with an inlined unsigned request object and
  foundry returns neither `openid4vp_uri` nor `request_uri`. Recovery creates a
  *new* `request_uri` session — that is what "Show QR code" does.
- **foundry needs `verifier.dc_api_expected_origins` to list the merchant
  origin.** Over the DC API transport the KB-JWT audience MUST be the
  browsing-context Origin. Unset, foundry accepts only an origin derived from
  its own `public_base_url`. Until this is configured, a merchant DC API
  payment fails `transaction_data_binding` *as a payment decline*, not as a
  transport error — nothing throws in the browser, so the "Show QR code"
  recovery never appears. `config.yaml` is gitignored in `../foundry`.

## Known-unverifiable

The wallet leg cannot be exercised in this environment: no phone and no EUDI
wallet app (`adb devices` shows none attached). Two Definition-of-Done items in
Plan 2 remain open for that reason, including confirming the real nesting shape
of foundry's disclosed verification claims (`apps/merchant/src/lib/checks.ts`
keeps both plausible branches on purpose).

The *reason* narrowed in Plan 3. This used to also say foundry's wallet-facing
listener was bound to `localhost:8443` rather than a public HTTPS origin. That
is no longer true of the deployed system: foundry is reachable at
`https://foundry.digitallabor.dev`, both apps are on public HTTPS origins
(`sparkasse-musterstadt.digitallabor.dev`, `larder-shop.digitallabor.dev`), and
a real checkout there produces an `openid4vp://` URI whose `request_uri` points
at that public foundry host. So the infrastructural blocker is gone and a human
with a device can now run the full flow.

That is a strictly different claim from having run it. No wallet flow has been
exercised. The local `pnpm dev` setup still talks to a `localhost` foundry.

Do not fake this. If a change depends on real wallet behaviour, say so.

The DC API work narrowed this further, in a way worth stating precisely.
Headless Chrome **does** expose `window.DigitalCredential` here (the DC API
plan wrongly assumed it does not), so everything up to the wallet handover is
locally verifiable and was verified: detection returns true, the merchant
creates a real `transport: dc_api` verification against a running foundry,
the row stores foundry's inline `dc_api_request` with `response_mode:
dc_api.jwt` and both URIs null, and the pay screen renders the DC API button
rather than a QR.

What remains unverified is only the leg that needs a wallet:
`navigator.credentials.get()` / `.create()` never resolve successfully here —
they throw, which is what exercised the fallback paths. So no wallet has ever
returned a `DigitalCredential`, no response has ever been relayed to
`/dc-api-response`, and `submitDcApiResponse` has never been called against a
real foundry.

## foundry

Not in this repo. Run it from `../foundry`:

```bash
./target/debug/foundry serve --config config.yaml
```

- Admin API: `127.0.0.1:9000`, `Authorization: Bearer dev-admin-key` — never
  publicly exposed.
- Wallet-facing: `0.0.0.0:8443` — must be publicly reachable over HTTPS for a
  real device.
- Issuance states: `offered | issued`. Verification states:
  `pending | verified | failed`.
- `config.yaml` is gitignored there; it needs the `com.emvco.dpc.card`
  credential type. Validate with `foundry config validate`.
- **A long-running local foundry may silently predate the feature you are
  testing.** The local server here had been up since Aug 5 and returned `200`
  for a deliberately invalid `offer_display` — serde ignores unknown fields, so
  an old binary accepts new request members and drops them. A 200 is therefore
  not evidence that a new field was honoured. Either assert on the echo
  (`credential_offer.display`) or send a known-bad payload and require the
  rejection. `pkill -f 'target/debug/foundry serve'` and restart it after
  pulling.
- **A rejected display payload is HTTP 500, not 400** — body
  `{"error": "invalid request: <path>: <reason>"}`. The error *code* is
  `invalid_request`; the status is not. Verified 2026-08-19 on both the local and
  the deployed instance.
- **Send `transaction_data` as plain JSON.** foundry performs the OpenID4VP
  base64url encoding itself and adds `transaction_data_hashes_alg` when the key
  is absent (`or_insert_with`, so an explicitly sent value wins rather than
  conflicts).
- **foundry validates `transaction_data[].credential_ids` against the resolved
  query's credential ids.** An id no query declares is a hard 400, not a
  `verified: false` verdict. Verified 2026-08-19 against the deployed instance.
- **`VerificationResult` is `{ verified, checks, credentials[] }`.** There is no
  top-level `claims`, and top-level `checks` is cross-cutting only
  (`jwe_decryption`, `requested_credentials_answered`).
  `transaction_data_binding` lives in `credentials[i].checks`, and claims are
  held per credential and never merged. See `apps/merchant/AGENTS.md`.
- **The local and deployed foundry configs differ in their named queries.**
  `../foundry/config.yaml` has only `over18` and `payment-age-loyalty`; the
  deployed `dl-infra-k8s/foundry/foundry_config.yml` has `dpc`, `dpc_av`, `av`,
  `dpc_discovery`, `dpc_by_network`, `payment` and `payment_av`. The merchant
  needs `payment` and `payment_av`, so **neither** of its paths — not even a
  plain basket — can be exercised against a stock local foundry. That is
  stricter than the `dpc` era, when the ordinary path did work locally.
- **foundry now verifies several credentials per `vp_token`.** The deployed
  config's warning that `dpc_av` "CANNOT be fully verified" is stale — the
  openapi serves `credentials[]` and `verify.rs` has `select_presentations`
  (plural). Do not reason from that comment; `payment_av` depends on exactly the
  capability it claims is missing.
- **`credential_sets` swaps a top-level verdict key.** A query carrying
  `credential_sets` reports `credential_sets_satisfied` instead of
  `requested_credentials_answered`; the two are mutually exclusive. `payment`
  and `payment_av` both carry it. No merchant code reads either key — both gates
  read `result.credentials` — so this is a fact to know, not a dependency.
- **The deployed admin key is not `dev-admin-key`.** Read it with
  `kubectl -n foundry get secret foundry-admin -o jsonpath='{.data.admin-api-key}' | base64 -d`.
