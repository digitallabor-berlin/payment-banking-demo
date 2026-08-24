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
**678 tests** (450 bank + 181 merchant + 11 foundry-client + 36 ui), measured
2026-08-24.

That was **673** before the Safari issuance fix, which added 5, all in
`packages/ui`: a whole new `invokeDcCreate` describe in `dcApi.test.ts`. Note
what that number reveals — `invokeDcCreate` and `invokeDcGet` had **no tests at
all** before it, which is exactly how a silent no-op shipped: `dcApi.test.ts`
covered `supportsDcApi`, `isDcApiNotSupportedError`, `prepareDcApiRequest` and
the protocol constants, i.e. everything *except* the two functions that touch
`navigator`. They were untested because they read the real global rather than
taking injected `globals` like `supportsDcApi` does; `vi.stubGlobal("navigator",
…)` is all it took. Only 3 of the 5 were red — the two that pin the *limits* of
the fix (a non-null return of any shape still resolves; a genuine throw
propagates unchanged) passed before the implementation existed, and are there to
stop the null check being "tidied" into a return-shape assertion. No plan; the
work was a reported bug.

That was **591** before the wallet-login work, which added 82, all in
`apps/bank`: 33 in the new `login-sessions.test.ts`, 22 in the new
`login-dialog-state.test.ts`, 12 in the new `login-checks.test.ts`, 4 in the new
`dc-api-relay.test.ts`, 3 in the new `transport.test.ts`, +3 in
`credential-types.test.ts`, +3 in `schema.test.ts` and +2 in
`authenticator-issuance.test.ts`. Two traps in that arithmetic. First,
`messages.test.ts` added **zero** despite both locales gaining an entire
`walletLogin` block plus two `login` keys — its invariants (identical key sets,
no empty leaf, no leaf byte-identical across locales) cover new leaves without
new cases, and a key present in one catalog and missing from the other is a
*compile* error rather than a test failure, so `pnpm typecheck` is the real gate
for copy and the test count is silent on it. Second, the +2 in
`authenticator-issuance.test.ts` is net of a rewrite: two existing tests
(`never persists the sub it sent`, and the join-key assertion in
`writes an offered row…`) pinned the old contract *directly* and had to be
inverted, because persisting the `sub` is the change. `payments.test.ts` was the
load-bearing cross-check there and did **not** change — it still proves an
`active` `sparkassen_auth` row, now carrying a non-NULL `credential_id`, is
refused a debit. No plan projection to compare against: the plan deliberately
refused to project one and said measure.

That was **587** before the Wero-payment fix, which added 4, all in
`apps/merchant`: +2 in `checks.test.ts` (a Wero-only binding pass and a Wero
`psu_id` read) and +2 in `settle.test.ts` (a Wero settle, alone and paired with
an age attestation) — the same two-file, same-shape split the Sparkassen-Card
work produced, because it is the same widening one option further along. Four
existing tests changed rather than being added, in three files: the two
`credential_ids` expectations in `payment-sessions.test.ts` and one each in
`dcql.test.ts` and `checks.test.ts`, all re-keyed to the three-element list.
Watch for the self-contradiction that showed up in the red run — a new
assertion asserted Wero outranks `sparkassencard` while the assertion beside it
assumed the opposite; the preference order is `PAYMENT_JOIN_KEY_CLAIM`'s
declaration order, `dpc > sparkassencard > wero`, and nothing else. No plan; the
work was a reported bug.

That was **546** before the Sparkassen Authenticator work, which added 41, all
in `apps/bank`: +11 in the new `authenticator-issuance.test.ts`, +11 in
`queries.test.ts` (a whole `getAuthenticatorCredentialState` describe), +9 in
`credential-types.test.ts` (the new id, the new `isAuthenticatorCredentialType`
block, and two exclusions in the existing predicates' describes), +8 in
`credential-copy.test.ts`, +1 in `payments.test.ts` and +1 in
`schema.test.ts`. Note the trap in that arithmetic: `credential-types.test.ts`
held **26** tests at HEAD, not the 29 an intermediate red run's "29 passed of
35" suggests — three of the nine additions passed before the implementation
existed, because they only assert that a plain string is rejected by predicates
that already existed. Two existing tests changed rather than being added: the
`FACE_COPY` keyed-by-kind assertion, which now compares against the test file's
own `KINDS` array instead of a hardcoded three-element list, and nothing else —
every `KINDS`/`FLAVOURS` loop picked the new kind up for free. No plan; the work
was a bounded request.

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
  That claim set is **confirmed** as of 2026-08-24: the deployed foundry declares
  `wero` with vct `https://creds.digitallabor.dev/vct/wero` and requires exactly
  `sub` and `masked_iban` (`psu_id` optional) — the three the bank already sends.
  It is offered for the EUDI
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
  girocard tiles and the Wero tile; *Credentials* holds the age attestation and
  the Sparkassen Authenticator. The catalog key was **renamed**
  `dashboard.cards` → `dashboard.payments`
  rather than re-worded in place — a key called `cards` holding "Payments" is the
  drift this catalog is strict about. en `Payments`, de `Zahlungsmittel`.

- **The Sparkassen Authenticator is the THIRD disjoint capability, and its
  claim set is ONE claim.** `sparkassen_auth` (underscore — foundry's spelling,
  not a choice) attests that the holder is an authenticated customer and nothing
  else: `{ sub: randomUUID() }`, minted per issuance, sent, **and — since wallet
  login — persisted** to `credential_id`. Still fresh per issuance, so two of
  these credentials cannot be correlated to each other by anyone; what changed is
  that the *bank* can now link a presentation to the customer it issued to, which
  is exactly what logging in requires. A credential issued **before** that change
  has an unrecoverable `sub` and can never log in — there is no backfill. It is in
  **none** of `CARD_FORMAT_TYPE_IDS`, `PAYMENT_CREDENTIAL_TYPE_IDS` or
  `AGE_CREDENTIAL_TYPE_IDS`; `isAuthenticatorCredentialType` is its predicate
  and `credential-types.test.ts` pins the disjointness in both directions
  against both other predicates. That matters because one of the three gates
  money: `payments.test.ts` proves an `active` `sparkassen_auth` row carrying a
  non-NULL `credential_id` is still refused with `unknown_credential`.

  Unlike Wero it needed its own route and its own issuance function.
  `POST /api/credentials/authenticator` and `startAuthenticatorIssuance` exist
  because Wero could reuse the card route only by virtue of being *payable* —
  a Wero row hangs off a `card_id` so `processPayment` can resolve an account.
  This credential has no card at all (`cardId: null`, `credentialId: null`,
  the age credential's row shape), so the card route would reject it and
  `startIssuance`'s IBAN join has nothing to do. Its route deliberately has **no
  body parser**: one format means nothing to name, so a parser would add a 400
  branch no caller can reach.

  The claim set is **confirmed** as of 2026-08-24, and is no longer the
  assumption this file recorded. `dl-infra-k8s/foundry/foundry_config.yml`
  declares `sparkassen_auth` with vct
  `https://creds.digitallabor.dev/vct/sparkassen_auth` and exactly one claim —
  `path: [sub]`, `required: true`, `selectively_disclosable: false` — so it wants
  `sub` and wants only `sub`. It is also the subject of
  `SPARKASSEN_AUTH_QUERY_ID` and `login-checks.ts`: the same id names a *named
  query* whose DCQL credential query id is likewise `sparkassen_auth`, and the
  bank keeps those as two separate constants because nothing forces the two
  registries to agree.

- **`#EA0016` is NOT `--color-primary`, despite what this file's CSS said for
  months.** Measured 2026-08-24: `--color-primary` is
  `oklch(0.6279 0.2576 29)` ≈ **`#ff0004`**, while `#EA0016` is
  `oklch(0.5892 0.2405 27.5)` — visibly darker and less saturated. The comment
  above `.card-object-av` asserted the token *was* `#EA0016`; it has been
  corrected. The consequence is load-bearing: `.card-object-auth` states the hex
  literally and must never be "simplified" to `var(--color-primary)`, which
  would silently change the card's colour. `.card-object-av`'s `#ff0000` is
  nearly the token by coincidence, not by intent.

- **`.card-object-auth` needs exactly TWO declarations beyond the colour, and
  both are the lessons Wero's face already taught.** `background-image: none`,
  because omitting the property does not clear `.card-object`'s
  `url("/card-face.webp")` and the girocard's photograph would show through the
  red; and `filter: none` on `[data-state="none"]`, because `saturate(0.82)`
  sits back a *photograph* on the girocard but merely dulls a flat brand colour.
  Nothing else is overridden — unlike Wero's face, the inherited white `color`
  is correct on this ground and the inherited box-shadow's red cast is this
  instrument's *own* colour rather than a borrowed one.

- **The authenticator face reuses the `SparkasseLogo` component, not a new
  `public/` asset.** The mark is drawn in `currentColor` inside `.card-brand`,
  and `.card-object` sets `color: #fff`, so it is already white on the red
  ground; a white-filled copy of the same path in `public/` would be a second
  source of truth for one glyph. (Contrast `wero-logo.svg`, which is an `<img>`
  precisely *because* inlining it would expose two `<linearGradient>` ids to
  collision — this glyph has no gradients.) Height-only sizing, since the mark
  is portrait at 0.769. Being a brand mark, it takes the corner the EU stars
  would occupy, so this face carries **no stars** and `active` is reported by
  the badge alone — the same trade Wero and the age face already make.

  The name is drawn as *type*, in the opposite corner: `.card-wordmark`
  (top-left) prints "Authenticator" as real text, because unlike the girocard
  (photograph) and the age credential (SVG) this face has no artwork to carry a
  name. That is also the one wordmark in this app a screen reader can reach. It
  is deliberately NOT `.card-label`, which is a 0.62-alpha field caption — a
  wordmark set as a caption reads as a label for whatever sits below it. Beyond
  that, only the holder's name is drawn over the ground: no IBAN, because this
  credential attests an identity and printing an account number would claim
  something it does not carry.

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
  `0001_even_bloodscream.sql`. Adding `sparkassencard`, `av-sparkasse`, then
  `wero`, then `sparkassen_auth` was a one-line schema edit and zero SQL each
  time.

- **The copy maps are keyed by what the copy varies with, NOT by credential type
  id.** `FACE_COPY` is keyed by `CredentialKind`
  (`card | age | wero | authenticator`) because
  one tile shows one badge for all of its formats; `DIALOG_COPY` is keyed by
  `IssuanceFlavour`
  (`card-eudi | card-google | age-eudi | age-google | wero-eudi |
  authenticator-eudi`) because
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
  (`com.emvco.dpc.card | sparkassencard | wero | sparkassen_auth | av |
  av-sparkasse`)
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

- **All five of `sparkassencard`, `wero`, `sparkassen_auth`, `av-sparkasse` and
  `av` ARE now declared — on the DEPLOYED foundry, and still on neither local
  one.** The operator's task described here is done. Re-measured 2026-08-24
  against `https://foundry.digitallabor.dev` (admin API via
  `kubectl -n foundry port-forward svc/foundry`), `POST /admin/issuance/offers`,
  the endpoint `createIssuanceOffer` posts to: `sparkassen_auth` with its real
  `{ sub }` claim is HTTP **200** with a live `credential_offer`, and every other
  id fails on *claim validation* — `{"error":"claim validation failed: missing
  required claim '<name>' for credential_type '<id>'"}` — never on
  `unknown credential_type_id`. That distinction is the whole measurement: the
  probe deliberately sent a bare `{ sub }` for all of them, so a declared type
  must complain about the claims it wants and an undeclared one about itself.
  Only `eu.europa.ec.av.1` is still unknown, and correctly so — it is an mdoc
  docType, never an admin-API credential type id.

  What each declared type wants, read off `dl-infra-k8s/foundry/foundry_config.yml`
  and consistent with those errors: `sparkassencard` and `wero` require
  `sub` + `masked_iban` (`psu_id` optional); `sparkassen_auth` requires `sub`
  alone; **both** `av-sparkasse` and `av` require `age_over_16` AND
  `age_over_18`, and both are `dc+sd-jwt` on the *same* vct
  `https://creds.digitallabor.dev/vct/av`. The bank's `AV_CLAIMS` already sends
  both booleans, so nothing is mismatched — but note the consequence for the
  merchant: both bank age formats answer the `av_sdjwt` DCQL query, and nothing
  the bank issues can answer `av_mdoc`, which wants an `mso_mdoc` of docType
  `eu.europa.ec.av.1` from some other issuer.

  The **local** `../foundry/config.yaml` is unchanged and still declares exactly
  three types — `pid`, `com.emvco.dpc.card` and `eu.europa.ec.av.1` — so every
  statement above holds only against the deployed instance, and a local `pnpm
  dev` still degrades each of these to a visible `failed` row (observed: clicking
  each age button wrote one `failed` row of the matching type, and Wero's one
  button wrote a `failed` `wero` row carrying `card_anna` and a bare-UUID join
  key; in the browser that is the tile's own inline
  `Angebot konnte nicht erstellt werden.` with **no dialog**, since
  `IssuanceDialog` only mounts once a 2xx offer exists).
  `com.emvco.dpc.card` is declared on both, and its issuance was
  verified end-to-end: HTTP 200, a real `openid-credential-offer://` deep link,
  and the display metadata echoed back in `credential_offer.display`.

- **The merchant accepts ANY of the THREE payment credentials, and the join key
  is per-format.** `selectNamedQuery` resolves foundry's `payment` / `payment_av`
  named queries (2026-08-24, replacing `dpc` / `dpc_av`). Each declares all three
  payment credentials as the options of one required `credential_sets`
  entry — `[[dpc], [sparkassencard], [wero]]` — so a holder of any can pay, and
  `transaction_data.credential_ids` is
  `["dpc", "sparkassencard", "wero"]` — naming a subset leaves the amount unbound
  whenever the wallet answers with one of the others. `extractCredentialId`
  (`apps/merchant/src/lib/checks.ts`) reads `credential_id` from a `dpc` answer
  and `psu_id` from a `sparkassencard` or `wero` one: a **map keyed by query id,
  never a fallback chain**. For `dpc` that is because the claim sets are disjoint
  and a claim-name collision must not decide who gets debited; for
  `sparkassencard` vs `wero` it is stronger than that — their claim sets are
  *identical*, so the query id is the only thing that tells them apart at all.
  `passedTransactionDataBinding` and
  `extractCredentialId` resolve **one** payment credential through a single
  shared helper, so the amount can never be bound to one card while the debit is
  keyed to another — which also means there is no "try the next payment
  credential" fallback when the resolved one's binding check failed.

- **A payment credential the merchant does not name is a DECLINE, not a gap —
  this is how every Wero payment broke.** Reported from a real wallet on
  2026-08-24: a `sparkassencard` checkout succeeded while a Wero one showed
  `The amount could not be confirmed against your wallet's approval.` The
  deployed foundry config had gained `wero` — as a credential type *and* as a
  third option in both named queries' `credential_sets` — and neither of the
  merchant's two lists had been widened with it. Two independent defects, and
  fixing only the second would have been worse than the bug:

  1. `PAYMENT_JOIN_KEY_CLAIM` in `checks.ts` knew only `dpc` and
     `sparkassencard`, so `findPaymentCredential` resolved **nothing** in a
     Wero-only verdict, `passedTransactionDataBinding` failed closed as designed,
     and `payment-sessions.ts` wrote `transaction_data_binding_failed` — the
     exact string the shopper saw.
  2. `buildTransactionData`'s `credential_ids` named only those same two.
     `transaction_data` binds **only** to the credentials it names, so a Wero
     KB-JWT carries no `transaction_data_hashes` and foundry genuinely cannot
     report the binding as passed on it.

  So the two lists are widened **together**, always: the first decides whether
  the amount can be confirmed, the second whether the merchant can tell the bank
  who to debit. Widening only the join-key map turns a decline into a settlement
  against an *unbound* amount, which is the one outcome `transaction_data` exists
  to prevent.

  Verified against the deployed foundry, not just in tests: the new payload is
  HTTP 200 under both `payment` and `payment_av`, a deliberately bogus id is
  still `400 transaction_data[0] references credential id '<id>' which is not
  present in the DCQL query` (so the 200s are evidence, not serde dropping an
  unknown field), and the request object fetched from the wallet-facing
  `request_uri` carries `credential_ids: [dpc, sparkassencard, wero]` against a
  query whose payment set is `[[dpc], [sparkassencard], [wero]]`. What remains
  unverified is the wallet's answer itself — see Known-unverifiable.

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
- **No revocation anywhere.** foundry exposes no revoke endpoint. Credentials
  expire on their configured lifetime, which is **per credential type and is not
  12 hours** — this file asserted a blanket 12h until 2026-08-24 and that was
  wrong. Measured from `dl-infra-k8s/foundry/foundry_config.yml`:
  `sparkassen_auth` and `sparkassencard` both carry
  `validity_seconds: 31536000`, i.e. **365 days**. The 12h figure is the *bank
  session cookie's* TTL (`session.ts`), which is a different thing entirely.
  Read the config for the type you care about rather than repeating a number.
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
  protocol, and a browser that can issue may still answer `false`. The claim
  that "the leniency is currently doing no work" was true only of Chrome —
  see the Safari bullet below, where it does plenty and all of it harmful.

- **Safari has the DC API but CANNOT issue, and `create()` reports that by
  resolving `null` rather than throwing.** This was a reported bug: in Safari the
  dialog's "Add to EUDI Wallet" button did nothing at all, on every credential,
  while Chrome fell back to a QR. Safari 26 ships the Digital Credentials API for
  **presentation only** (`get`, protocol `org-iso-mdoc`); issuance is not
  implemented. But it therefore *has* `window.DigitalCredential`, and it has
  `navigator.credentials.create` because WebAuthn does — which is the whole of
  what `supportsDcApi("create", …)` inspects before its lenient short-circuit.
  So `dcSupported` is `true`, the dialog renders the DC API button instead of the
  QR, and the click goes to a browser that will not issue. Per Credential
  Management, `create()` resolves with `null` when the options carry no
  credential type it recognises, and `invokeDcCreate` used to treat non-throw as
  success outright — so the click was a permanent silent no-op: no error copy, no
  `dcFailed`, and never the QR fallback. Measured in real Safari 26.5.2 by
  monkey-patching `navigator.credentials.create` on the deployed bank:
  `CREATE RESOLVED: null`.

  The fix is a null/undefined check in `invokeDcCreate`, raised as a
  `DOMException` named `NotSupportedError` so `isDcApiNotSupportedError` routes
  it to the "this browser cannot" copy rather than "you cancelled". It must stay
  a **null check** and never grow into a return-SHAPE assertion like
  `invokeDcGet`'s: Chrome's documented issuance example ignores `create()`'s
  return value, so demanding a `DigitalCredential` would manufacture failures on
  a successful handover. "Nothing was created" is strictly weaker than "not the
  type I wanted", and only the former is safe to assert. Two tests exist purely
  to pin that boundary.

  The gate was deliberately **not** tightened. Reading
  `userAgentAllowsProtocol` for `create` would reintroduce exactly the false
  negative the leniency was written to avoid, and the accepted cost of the
  lenient gate — "a false positive costing one visible click" — is now actually
  paid rather than hypothetical: a Safari user clicks once, gets the unsupported
  message, and the QR appears beneath it. Note this also means Safari never had a
  working issuance path and still does not; what changed is that it now degrades
  to the cross-device QR instead of appearing broken.
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
- **OPERATOR DEPENDENCY, open: the BANK's origin is not in
  `dc_api_expected_origins`.** Measured 2026-08-24 from
  `dl-infra-k8s/foundry/foundry_config.yml`, which reads
  `["https://foundry-admin.digitallabor.dev", "https://larder-shop.digitallabor.dev"]`
  — the merchant is listed, the bank is **not**. Wallet login now makes the bank
  a verifier too, so `https://sparkasse-musterstadt.digitallabor.dev` must be
  added or a same-device (DC API) wallet login **declines silently**: the KB-JWT
  audience is the browsing-context Origin, foundry rejects it, and the failure
  surfaces as an ordinary failed verification rather than as a transport error.
  Cross-device (QR / `request_uri`) login is unaffected.

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

That is a strictly different claim from having run it. **A human has now run
it** — 2026-08-24, reported by the operator rather than measured here: a real
wallet paid a real checkout with a `sparkassencard` credential and it "works
fine", while the same flow with a Wero credential declined with
`The amount could not be confirmed against your wallet's approval.` So the
wallet leg is no longer hypothetical, and the *bug that report describes* was
reproduced from the code and fixed (see the Wero decline bullet under
"Credentials and credential types").

Treat that as one operator report, not as coverage. Nothing in this repo has
observed a `vp_token`, so the actual claim *values* a wallet discloses remain
unseen — only the schema is pinned. Specifically still unobserved: any age
credential in either format, and any Wero presentation, since the fix has only
been verified as far as the request object foundry serves to the wallet. Ask the
operator to re-run the Wero checkout before calling that path proven. The local
`pnpm dev` setup still talks to a `localhost` foundry, which declares neither
the named queries nor four of the five credential types, so none of this is
reproducible locally.

**No wallet has ever answered the `sparkassen_auth` query either**, as of
2026-08-24 — wallet *login* is in exactly the same position as everything above.
What is verified is the request leg, against the deployed foundry:
`POST /admin/verification/requests` with `named_query_ref: sparkassen_auth`
returns **HTTP 200** and a real `openid4vp://` URI, while a bogus named query
returns **HTTP 400 `unknown named_query_ref`**, so the 200 is evidence rather
than serde dropping a field. The request object served at `request_uri` carries
DCQL `id: sparkassen_auth`, vct
`https://creds.digitallabor.dev/vct/sparkassen_auth` and a **flat** `sub` claim
path. So `extractAuthSubject`'s shape is pinned by foundry's config, not by
observation — nothing has seen a `vp_token` answering it, and the whole path
from the wallet's response through `refreshLoginSessionState` to a minted cookie
is unexercised.

A trap when checking any of this against the deployed admin API: a **local**
foundry may own `127.0.0.1:9000` (IPv4) while `kubectl port-forward svc/foundry
9000:9000` binds only `[::1]:9000`. A curl to `127.0.0.1:9000` then silently hits
the *local* server and answers 401 with the deployed key, which reads as a bad
secret. Forward to a distinct port (e.g. `9100:9000`) rather than trusting the
address.

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
