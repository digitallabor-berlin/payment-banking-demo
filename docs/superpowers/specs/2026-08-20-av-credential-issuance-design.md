# Age-Verification Credential Issuance — Design

**Date:** 2026-08-20
**Status:** approved
**Scope:** `apps/bank` only. No merchant change. No foundry change.

## 1. Goal

The bank can issue a second credential type into the user's EUDI wallet: an
age-verification attestation, alongside the existing EMVCo Digital Payment
Credential.

This is deliberately **a separate feature**, not an extension of the payment
flow. Nothing in this repo verifies the new credential. The merchant's `dpc_av`
checkout escalation exists and would consume an age credential, but wiring the
two together is out of scope and is not attempted here.

## 2. What the bank sends

`POST /admin/issuance/offers` on foundry's admin API, with exactly:

```json
{
  "credential_type_id": "av",
  "claims": { "age_over_16": true, "age_over_18": true }
}
```

Three properties of that payload are requirements, not incidentals:

- **`credential_type_id` is `av`.** Fixed by the operator (see §3).
- **The claims are the two booleans above, and nothing else.** No birthdate, no
  name, no `credential_id`. An age attestation that carries a birthdate defeats
  its own purpose.
- **No `offer_display` and no `credential_response_display`.** These are not
  merely unnecessary — they are rejected. `foundry-issuer/src/create_offer.rs`
  gates both fields on `ct.vct == "com.emvco.dpc.card"` and returns
  `invalid_request` for any other credential type. Sending the bank's card
  display metadata here would turn every AV issuance into a failed row.

The consequence: the wallet's rendering of this credential comes entirely from
foundry's static `display:` block for the `av` credential type. The bank cannot
influence it, and `av-face.svg` (§6) is therefore the bank's *own* UI artwork
only, not something the wallet ever sees.

## 3. Out of scope: the foundry credential type

foundry cannot issue `av` today. The live configmap
(`kubectl -n foundry get cm foundry-config`) declares only `pid` and
`com.emvco.dpc.card` under `credential_types`, while its `named_queries` already
reference `av` as `format: mso_mdoc`, `doctype_value: eu.europa.ec.av.1`, claim
path `[eu.europa.ec.av.1, age_over_18]`.

Adding that credential type is the operator's task and is explicitly **not part
of this work**. Two facts recorded here so the eventual config lands correctly:

- foundry's mdoc issuance path (`credential.rs`, the `"mso_mdoc"` arm) puts every
  flat claim key into a single namespace equal to the resolved docType. So the
  flat claims in §2 become `eu.europa.ec.av.1 → { age_over_16, age_over_18 }`,
  which is exactly what the `av` named query asks for.
- That same arm resolves the docType as `vct.or(doctype)`. A config entry
  carrying **both** `vct` and `doctype` therefore silently uses `vct` — see
  foundry's own `GAP-VCI-12`. The `av` entry must set `doctype` only.

**Until that config exists, the happy path is unreachable.** `startAvIssuance`
receives `unknown_credential_type`, writes a `failed` row, and the dialog shows
its failure state. That is correct behaviour, and it is the only end-to-end
behaviour this work can honestly claim to have verified.

## 4. Data model

`credentials` gains a type discriminator and relaxes two `NOT NULL`s:

```ts
cardId:           text("card_id").references(() => cards.id),          // was .notNull()
credentialTypeId: text("credential_type_id", { enum: ["com.emvco.dpc.card", "av"] })
                    .notNull().default("com.emvco.dpc.card"),           // new
credentialId:     text("credential_id").unique(),                      // was .notNull()
```

An AV row has `cardId = null` and `credentialId = null`.

**Why the new column carries a default.** Two reasons, both practical. It makes
the migration's backfill automatic — a table rebuild's `INSERT … SELECT` that
omits the column gets the default, so no SQL needs hand-editing. And there are
seven direct `insert(credentials)` sites in existing tests plus one in
`issuance.ts`; a `NOT NULL` column with no default would break all eight for no
gain. The default states the system's own history: a credential here is a payment
credential unless it says otherwise. The cost is that an insert which *forgets*
the field silently becomes DPC, so a test asserts `startAvIssuance` writes `av`
explicitly, and `issuance.ts` names the DPC constant rather than relying on the
default.

**Why `credentialId` is null rather than a minted-but-unused value.** It is the
truth: an age attestation has no payment join key, and none is disclosed to
anyone. It is also a structural safety property — `processPayment` looks up
`where credential_id = <non-null string>`, and SQL never matches NULL, so an AV
row cannot settle a payment even if every explicit guard were deleted. SQLite
permits many NULLs under a UNIQUE index, so the DPC uniqueness invariant is
untouched.

**Why one table rather than a separate `attestations`.** `refreshIssuanceState`
and `GET /api/credentials/[id]/status` read `credentials` and are already
type-agnostic — they touch only `foundryTxId` and `state`. A second table forks
that polling machinery for no gain. One table reuses it verbatim.

`listCards` needs no change: its inner lookup is
`eq(credentials.cardId, card.id)`, which is a NULL comparison for every AV row,
so an age credential can never surface on a card tile.

### 4.1 Payment-path guards

`processPayment` gains two guards after the credential lookup:

- `credentialTypeId !== "com.emvco.dpc.card"` → `unknown_credential`. The
  semantic guard: an age attestation is not a payment instrument.
- `!cardId` → `unknown_credential`. Compiler-forced, since `credential.cardId`
  is now `string | null` and `eq(cards.id, …)` requires a string. It narrows the
  type and closes the same hole a second time.

Together with the NULL-matching property above, there are three independent
reasons an age credential cannot move money.

### 4.2 Migration

Migration `0001`, generated by `pnpm --filter @demo/bank db:generate`. SQLite
cannot relax `NOT NULL` in place, so drizzle-kit emits a table rebuild
(`__new_credentials`, copy, drop, rename). The generated SQL must be **read, not
assumed**, and three properties confirmed before it is committed: the `UNIQUE` on
`credential_id` survives the rebuild, `credential_type_id` carries its default so
existing rows are backfilled, and the copy lists every retained column. A test
asserts an existing DPC row survives with its type intact.

## 5. Issuance

New `src/lib/av-issuance.ts`, a **sibling** of `issuance.ts` rather than a
generalization of it:

```ts
export async function startAvIssuance(
  db: Db, client: FoundryClient, userId: string, now?: number,
): Promise<StartAvIssuanceResult>
```

`StartAvIssuanceResult` is `{ ok: true; sessionId; offerUri; dcApiOffer }` or
`{ ok: false; reason: "foundry_unavailable" }`. There is no `card_not_found`
branch — there is no card.

It mirrors `startIssuance`'s one load-bearing ordering property: the row is
written **before** foundry is called, so an outage leaves a visible `failed` row
rather than nothing.

Generalizing `startIssuance` instead was rejected: it joins `accounts` for the
IBAN, derives `card.last_four`, builds two display arrays, and returns a
card-specific failure. A single function serving both would branch on nearly
every line. The two paths share a shape, not a body.

The credential-type constants move to `src/lib/credential-types.ts`
(`DPC_CREDENTIAL_TYPE_ID`, `AV_CREDENTIAL_TYPE_ID`), bound to the schema enum
with `satisfies`, so `payments.ts` can name the DPC type without importing
`issuance.ts` and dragging in the foundry client, `env`, and display metadata.

**Reused unchanged:** `refreshIssuanceState`,
`GET /api/credentials/[id]/status`, `useStatusPoll`, and the whole DC API
handover. New route: `POST /api/credentials/av`, wrapped in `withSession` (no
dynamic segment, so the wrapper's missing `context` forwarding is not a problem
here), returning the same `{ sessionId, offerUri, dcApiOffer }` shape.

## 6. UI

The dashboard gains a third section below `Karten`:

```tsx
<h2 className="eyebrow">Nachweise</h2>
```

holding one `AgeCredentialTile`. An age attestation is not a card — it has no
IBAN, no PAN and no network — and filing it under `Karten` would erase the one
distinction this feature exists to draw.

- **`apps/bank/public/av-face.svg`** — the supplied artwork verbatim. Vector,
  ~3.5 KB, no conversion. The Dockerfile already copies the bank's whole
  `public/` (line 70), added when the card artwork landed, so there is no build
  change.
- **`.card-object-av`** overrides only `background-image` and
  `background-color`. The fallback colour is `#FF0000`, the artwork's own red —
  *not* Sparkasse `#EA0016` — so a missing asset degrades to the right red.
  Geometry, radius, shadow and the `data-state="none"` desaturation are
  inherited from `.card-object`.
- **Nothing is drawn over the face.** The artwork already carries
  `Altersnachweis / Proof of Age` top-right and the Sparkasse logo bottom-left.
  This is the same lesson the card artwork taught: `.card-chip`, `.card-network`
  and the on-card logo were deleted once the real artwork contained them.
- **No `EuStars` on the AV face.** `.card-stars` is positioned top-right, which
  on this artwork is exactly where the wordmark is printed. The `active` state is
  carried by the badge alone.
- **`.card-sheen` is kept** while an offer is in flight, for the same reason the
  card has it: it is the only motion in the app and it only runs while something
  is actually happening.
- The tile keeps an `<h3>Altersnachweis</h3>` even though the face says it.
  `.card-object` is a CSS background with no alt text, so that heading is the
  credential's only accessible name.

`cardFaceState` is reused unchanged — the "offered is session-scoped, never read
back from the database" reasoning applies identically, and for the same reason
(nothing in this project ever clears an `offered` row).

### 6.1 Copy

All German. Two modules' worth, both in `.ts` so vitest reaches them — every
vitest project is `environment: "node"` with `include: ["src/**/*.test.ts"]`, so
a string decided inside `.tsx` is never covered.

`src/lib/credential-copy.ts` holds two records keyed by credential type id:

- `FACE_COPY[type][faceState]` → `{ badge, badgeClass, explain }`. The DPC entry
  is today's `STATE_COPY` moved verbatim; `card-state.ts` keeps exporting
  `STATE_COPY` as `FACE_COPY[DPC_CREDENTIAL_TYPE_ID]` so `CardTile` and its
  existing tests are untouched.
- `DIALOG_COPY[type]` → `{ title, successTitle, successBody, failureBody }`.

`IssuanceDialog` currently hardcodes `Karte` in four strings. German gender
differs (`die Karte` / `der Altersnachweis`), so a noun-substitution prop is not
enough; the dialog takes a `copy: IssuanceCopy` prop and both call sites pass
their record. The DPC record reproduces today's strings exactly, so this is a
refactor with no user-visible change on the card path.

AV copy:

| Slot | String |
| --- | --- |
| `badge` none / offered / active | `Nicht im Wallet` / `Wird hinzugefügt…` / `Im Wallet` |
| `explain` none | `Fügen Sie Ihren Altersnachweis Ihrem EUDI Wallet hinzu, um Ihr Alter online zu bestätigen.` |
| `explain` offered | `Bestätigen Sie das Angebot in Ihrer Wallet-App.` |
| `explain` active | `Ihr Altersnachweis ist in Ihrem EUDI Wallet und einsatzbereit.` |
| `title` | `Altersnachweis zum EUDI Wallet hinzufügen` |
| `successTitle` | `Altersnachweis hinzugefügt` |
| `successBody` | `Ihr Altersnachweis ist jetzt in Ihrem EUDI Wallet.` |
| `failureBody` | `Der Altersnachweis konnte nicht hinzugefügt werden.` |

The DC API diagnostic strings stay English, unchanged — a browser-capability
failure is a technical signal, not customer copy.

## 7. Queries

`getAgeCredentialState(db, userId)` in `src/lib/queries.ts`, returning
`{ state: CardCredentialState; credentialRowId: string | null }`. Same rule as
`listCards`: newest non-`failed` row wins, filtered to
`credentialTypeId = 'av'`. One age credential per user; there is no per-card
scoping because there is no card.

## 8. Seeding

Unchanged. `seed()` issues no credentials — the existing comment ("issuing one
requires a real wallet") holds for the age credential too. The button is
disabled once the state is `active`, matching `CardTile`.

## 9. Testing

TDD throughout. Baseline measured 2026-08-20: **329** (120 bank + 167 merchant +
11 foundry-client + 31 ui). The plan's per-task arithmetic adds **27**, all in
`apps/bank`, projecting 356. Measure the real number; do not restate the
projection — two earlier plans in this repo got theirs wrong.

Covered:

- the migration's backfill and row preservation, and that both relaxed columns
  accept NULL
- that an AV row cannot settle a payment, by type and by null `cardId`
- `getAgeCredentialState` across none / offered / active / newest-wins /
  ignores-failed / ignores-DPC
- `startAvIssuance`'s exact request (`credential_type_id`, both claims, **no**
  display members), row-before-foundry, `foundryTxId` persistence, and the
  `failed` row on a throw
- that both copy records exist, are distinct, and that no AV string says `Karte`

Not covered, and known: `AgeCredentialTile.tsx` and the `page.tsx` section are
`.tsx` and therefore invisible to every vitest project. That is why every
decision above lives in a `.ts` module.

## 10. Definition of done

- `pnpm check` green; the real test count reported, not the projection.
- `pnpm build` green (the webpack `extensionAlias` requirement makes a passing
  vitest run insufficient evidence).
- The failure path exercised against a **freshly restarted** local foundry: a
  real `POST` for `credential_type_id: "av"` is rejected, and the row lands
  `failed`. A long-running foundry binary may predate a feature and serde-ignore
  unknown fields, so a 200 from a stale server is not evidence of anything.
- Browser verification of the new section via `tools/cdp/cdp.mjs` against a
  production server (`pnpm dev` is broken — see `AGENTS.md`).
- `AGENTS.md` and `apps/bank/AGENTS.md` updated: the new test count, the
  `credentials` shape change, the display-metadata prohibition for non-DPC
  types, and the fact that the happy path awaits an operator config change.

## 11. Explicitly not done

- No foundry config change, local or deployed.
- No merchant change. The `dpc_av` escalation is not wired to this credential.
- No wallet leg. `navigator.credentials.create()` has never returned a
  credential in this environment, and that does not change here.
