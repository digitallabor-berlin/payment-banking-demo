# Changing the customer's mobile number, approved in the wallet

Status: design. 2026-10-20.

Three calls in here are the author's rather than the requester's and are marked
as such at the point they are made: the digits-only comparison in
`phone_unchanged`, the absence of an audit row, and the `+` requirement in
`isValidPhoneNumber`.

## Intent, and the why

The demo can already show a wallet approving a *setting* (the daily transfer
limit) and a *payment* (send money). This adds a third shape that is neither:
approving a change to **who the bank can reach you at**.

That is worth demonstrating on its own terms. A mobile number is the pivot of
nearly every account-takeover: change it and you redirect the SMS codes, the
fraud alerts, and the call-back the branch would have made. Banks hedge it today
with an SMS to the *old* number — a channel the attacker is in the middle of
trying to take. Here the approval happens on a credential bound to the holder's
device, over a channel the attacker does not have, and the holder reads both the
old number and the new one before pressing Confirm.

It is also the first transaction data in this repo whose claims are **plain
text**. The limit change signs two amounts; the transfer signs an amount plus
three strings. This one signs two strings and nothing else, which makes it the
cleanest illustration of what `transaction_data` is for — the payload is the
sentence the holder is being asked to agree with.

## What exists already, and is reused unchanged

Nothing in this feature is new machinery. It is the limit-change flow with a
different payload and a different terminal write.

- `sparkassen_auth`, the Sparkassen Authenticator credential, and the
  `SPARKASSEN_AUTH_NAMED_QUERY` / `SPARKASSEN_AUTH_QUERY_ID` constants.
- `extractAuthSubject` and `passedLoginBinding` in `lib/login-checks.ts`.
- `FoundryClient.createAdHocMetadata`, `createVerificationRequest`,
  `getVerificationStatus`, `submitDcApiResponse`.
- `lib/transport.ts` — `selectTransport`, `isDcApiTransport`,
  `resolveDcApiProtocol`, `parseDcApiForm`, and the `?dcapi=unsigned` opt-out
  already threaded through `DashboardPage`.
- `selectLoginAffordance` (`lib/login-dialog-state.ts`) and `needsQrRecovery`
  (`lib/limit-dialog-state.ts`), imported rather than copied — exactly as
  `SendMoneyDialog` imports them today.
- `QrCanvas`, `useDcApiSupport`, `useIsTouch`, `useStatusPoll`,
  `invokeDcGet`, `prepareDcApiRequest`, `isDcApiNotSupportedError` from
  `@demo/ui`.
- `CheckMark` / `AlertMark`, `.panel`, `.eyebrow`, `.dialog-overlay`,
  `.dialog-card`, `.btn`.

**No foundry configuration change is required.** The ad-hoc metadata JWT is what
makes a transaction data type nothing declares renderable (PaSO Proof Metadata
§5.4), and `sparkassen_auth` is already the one credential on the deployed
foundry carrying a `credential_metadata_uri`. This is the same §5.4 case the
limit change and the transfer are.

## Goals

- A **Your details** section on the bank dashboard showing the technical
  username and the mobile number.
- A **Change** control on the mobile row only, opening a dialog with a single
  field pre-filled with the number in force.
- The wallet consent screen reads, in the holder's language:

  > **Current mobile number** +49 171 5555555
  > **New mobile number** +49 172 66666666
  > *Sparkasse will never ask you to change your mobile number.*
  > [ Cancel ] [ Confirm number ]

- The number is written **only** after a verified presentation from a
  Sparkassen Authenticator the bank issued **to the customer who is logged in**.
- The dashboard shows the new number without a manual reload.
- Bilingual, EN and DE, in both the bank's own UI and the consent screen.

## Non-goals

- No SMS, no one-time code, no verification of the number against a carrier.
  The wallet confirmation **replaces** the SMS step; adding one back would
  undercut the point of the demo.
- No landline, no second number, no "primary"/"secondary". One mobile number per
  customer.
- No "verified" / "pending verification" state on the number. It is changed or
  it is not.
- No number-equality normalisation. `+49 171 5555555` and `+491715555555` are
  two different strings to this system — see **Storage format**.
- No change to the username. It is displayed because it is the other fact a
  customer would look for in a details panel, and it is immutable here.
- No audit row in `transactions`, and nothing anywhere shows a history of
  changes. A phone change is not a booking — contrast the transfer, which writes
  one because money moved. Author's call: the `phone_change_sessions` row is the
  record, and surfacing it would mean designing a second ledger for a demo that
  has one.

## Anti-goals — outcomes worse than not shipping

- **A consent screen with a blank or stale "Current mobile number".** That is
  the half of the sentence the holder uses to decide. If it can be empty or
  wrong, the screen is theatre.
- **A `transaction_data` entry with no `metadata`.** Measured on the deployed
  foundry (2026-10-19): such an entry is accepted at HTTP 200. Nothing
  server-side stops it. Best case a wallet refuses; worst case it renders
  `old_phone: +49 171 5555555` as a raw key-value pair, which *looks like the
  feature working*.
- **An invented `value_type` on either claim.** See **The claims are plain
  text** below. This refuses the entire presentation, not one label.
- **A stranger's valid authenticator approving this customer's change.** Without
  the ownership gate, any `sparkassen_auth` presentation would do.
- **A number written against an approval of a different transition.** If the
  stored number moved while the approval was in flight, what the holder signed
  is no longer what would happen.

## The flow

1. The customer presses **Change** on the mobile row of the Your details panel.
2. A dialog opens with one text field, pre-filled with the number in force, and
   **Continue** / **Cancel**. Continue is disabled while the field is empty,
   unchanged, or not a plausible number — a convenience only; the server gate is
   authoritative.
3. Continue `POST`s to `/api/profile/phone-change` with the new number and the
   transport the browser resolved.
4. `startPhoneChange` resolves the customer, validates the number, writes a
   `pending` row, **mints the ad-hoc metadata JWT**, and only then creates the
   verification request. A failed mint aborts without ever creating one.
5. The dialog swaps to the wallet face — a wallet button on a touch device with
   the DC API, a QR otherwise, with the same "Show QR code" recovery.
6. The holder approves in the wallet.
7. The dialog's poll (`GET …/{sessionId}`, ~2s) reaches
   `refreshPhoneChangeState`, which runs the four gates and writes `verified`.
8. On `verified` the dialog `POST`s `…/{sessionId}/apply`. That writes the
   number and moves `verified → applied`, in one transaction.
9. `router.refresh()`; the panel behind the dialog re-renders from the server
   with the new number. The dialog shows success naming it.

## The `transaction_data` entry

One entry, plain JSON — foundry performs the OpenID4VP §8.4 base64url encoding
itself, so a pre-encoded value would be double-encoded. That applies to
`metadata` too: the minted JWT rides verbatim.

```jsonc
{
  "type": "urn:paso:sca:dev.digitallabor:phone-change:1",
  "credential_ids": ["sparkassen_auth"],      // SPARKASSEN_AUTH_QUERY_ID
  "transaction_data_hashes_alg": ["sha-256"],
  "payload": {
    "old_phone": "+49 171 5555555",
    "new_phone": "+49 172 66666666"
  },
  "metadata": "<compact JWS from createAdHocMetadata>"
}
```

- `type` follows PaSO Core §5.2's
  `urn:paso:sca:<domain>:<suffix>:<version>` form, reusing the
  `dev.digitallabor` domain. The trailing `:1` is a version and it earns its
  keep: a wallet rendering this payload needs to know which shape it has.
- `credential_ids` is the **DCQL query id**, not the credential type id. They
  share a spelling and are deliberately separate constants; foundry validates
  this list against the resolved named query and answers **400** on an unknown
  one. Build it from `SPARKASSEN_AUTH_QUERY_ID`.
- `metadataJwt` is a **required** parameter of the builder, not optional. The
  caller must abort when the mint fails rather than send an entry without it.
- The payload strings are **byte-identical** to what is stored and what the
  dashboard renders. They are hashed into `transaction_data_hashes`, so any
  derivation applied between the column and the payload becomes part of the
  signed artefact — see **Storage format** for why there is no derivation at
  all here.

## The claims are plain text — no `value_type` anywhere

PaSO Proof Metadata §3.1 makes `value_type` optional and defines an omitted one
as plain text. PaSO View §3 says a wallet **shall exclude** an entry whose
declared `value_type` it does not support.

Exclusion is of the **entry**, not of the label. So a plausible-looking
`"value_type": "phone_number"` or `"e164"` is a hard refusal of the whole
presentation — the holder reads *"Transaction can't be displayed"* and the
change cannot be approved at all. There is no registered value type for a
telephone number and inventing one is the single most likely way to break this
feature.

This is the transfer's hard-won lesson applied in full. `TransferAdHocMetadata`
makes `value_type` **required** on every claim because both of its amount claims
have one; `LimitChangeAdHocMetadata` does the same. Neither can express a claim
without one, so **this feature declares its own `PhoneChangeAdHocMetadata`
interface** in which `value_type` is absent from the claim type entirely. Import
`LocalisedName` and `LocalisedValue` from `limit-transaction-data.ts` — those two
genuinely are the same shape — and declare the rest locally.

The test that matters is `expect(claim).not.toHaveProperty("value_type")` on
both claims. Write it before the builder.

## The ad-hoc metadata JWT

Minted per request via `FoundryClient.createAdHocMetadata`, with
`credential_type_id: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID`,
`transaction_data_type` **equal to the entry's own `type`** (foundry binds the
two; a mismatch makes the override cover a type nothing sends), and
`ttl_secs: 900`.

`ttl_secs` is stated explicitly for the reason the limit change states it:
foundry's default is 300 seconds, *exactly* the session TTL, and the JWT is
minted after the row is written — so a holder approving at T+295 would hand the
wallet a JWT with seconds left, and a §5.3 `exp` failure is indistinguishable
from a holder pressing Cancel. Measured: the deployed foundry honours 900.

```jsonc
{
  "claims": [
    {
      "path": ["old_phone"],
      "mandatory": true,
      "display": [
        { "locale": "en", "name": "Current mobile number" },
        { "locale": "de", "name": "Aktuelle Mobilnummer" }
      ]
    },
    {
      "path": ["new_phone"],
      "mandatory": true,
      "display": [
        { "locale": "en", "name": "New mobile number" },
        { "locale": "de", "name": "Neue Mobilnummer" }
      ]
    }
  ],
  "ui_labels": {
    "transaction_title": [
      { "locale": "en", "value": "Confirm your new mobile number" },
      { "locale": "de", "value": "Neue Mobilnummer bestätigen" }
    ],
    "affirmative_action_label": [
      { "locale": "en", "value": "Confirm number" },
      { "locale": "de", "value": "Nummer bestätigen" }
    ],
    "denial_action_label": [
      { "locale": "en", "value": "Cancel" },
      { "locale": "de", "value": "Abbrechen" }
    ],
    "security_hint": [
      { "locale": "en",
        "value": "Sparkasse will never ask you to change your mobile number." },
      { "locale": "de",
        "value": "Die Sparkasse wird Sie niemals bitten, Ihre Mobilnummer zu ändern." }
    ]
  }
}
```

Claim **order is consent order**: old then new, so the screen reads as a
transition rather than as two facts.

`affirmative_action_label` is **"Confirm number"** verbatim from the request.

The `security_hint` is the one label saying something the two numbers do not.
Redirecting a victim's mobile number is a standard step in account takeover and
in SIM-swap fraud, where the fraudster talks the victim through the bank's own
UI. PaSO §3.2 requires the wallet to display this verbatim and forbids altering
or removing it, so the bank's warning cannot be dressed up by whatever is
driving the browser.

### Locale tags are bare `en` and `de`

Not `en-US` / `de-DE`. This is settled and was learned the expensive way: region
tags broke **every** real presentation of the limit change with *"Transaction
can't be displayed"* (reported 2026-10-19).

RFC4647 §3.4 Lookup only ever **shortens** the user's range, so a region tag is
strictly *less* reachable: `en-US` matches only a phone whose range is `en-US`,
while `en` matches `en`, `en-US`, `en-GB`, `en-IE` and the rest. Measured
against El Paso's `LocaleSelector`, phones on `en-GB`, `de-AT`, `de-CH`, bare
`en` or `fr-FR` selected no locale at all — and PaSO View §4 is all-or-nothing,
so that refuses the whole presentation rather than degrading one label.

Both locales are always sent regardless of the bank's current UI locale: the
wallet picks by its own priority list, which the bank cannot observe.

**Note a stale comment to not propagate.** `messages.ts` currently claims the
consent screen's tags are `en-US` / `de-DE`. That is out of date. Correct it
while adding the new copy block.

## Failure of the mint is failure of the whole request

`startPhoneChange` mints **before** creating the verification request and
returns `metadata_unavailable` if the mint fails, never creating one.

Two reasons this ordering is load-bearing rather than tidy:

1. An entry with no `metadata`, for a type no credential metadata document
   declares, is PaSO Core §7.4.2 "incompatible" — the anti-goal above.
2. **Nothing server-side enforces it.** Measured on the deployed foundry: an
   entry with `metadata` deliberately omitted is accepted at HTTP 200. The
   bank's own ordering is the only thing standing between this demo and its
   anti-goal.

A **2xx is not a successful mint.** `FoundryClient.request` does
`JSON.parse(text) as T` and throws only on a non-2xx or a non-JSON body, so a
200 carrying `{}` leaves `minted.jwt` undefined with nothing raised — and
`JSON.stringify` then silently **drops** `metadata` from the entry. Check
`typeof minted.jwt === "string" && minted.jwt.length > 0` explicitly.

The test that pins this must script the verification request as a perfectly good
200, so the **only** thing that can stop the call is the code:
`creates NO verification request when the mint fails`.

## Data

### `users.phone_number`

```ts
phoneNumber: text("phone_number").notNull().default("+49 171 5555555"),
```

A **real** `ALTER TABLE … ADD COLUMN`, not a TypeScript-only widening like
`credential_type_id` or `transport`. Read the generated SQL before committing —
drizzle-kit has emitted an unrunnable table rebuild twice in this repo (`0001`,
the merchant's `0004`) and a clean plain ADD twice (`0006`, `0007`). Apply it to
a real SQLite file and run `pnpm seed` twice before claiming it works.

On `users` rather than `accounts`, by decision: a customer has one mobile number
however many accounts they hold, which is the opposite of `daily_limit_cents`
(per-account, by requirement). It also means this flow has **no account id**
anywhere — see **Routes**.

The DEFAULT exists only to backfill pre-existing rows in a developer's database;
`seed()` deletes and re-inserts every user, so no seeded row ever carries it.
It is a real German mobile prefix rather than an empty string because a NOT NULL
empty string would render a blank consent-screen row, which is the first
anti-goal.

**Not added to the session cookie.** `SessionPayload` stays `{ userId,
displayName }`. A cookie is minted for 12 hours; a number cached in it would be
stale the moment this feature works. This is the reason `login_sessions`
deliberately does not store `displayName` either — the read re-resolves from
`users`.

### Seed fixtures

Each fixture gains a `phoneNumber`. Anna's is `+49 171 5555555`, matching the
request. Ben's must be **different** — e.g. `+49 160 2345678` — or a test that
proves the right customer's row was written could pass by coincidence.

### `phone_change_sessions`

Modelled directly on `limit_change_sessions`. Deliberately **not** generalised
into a shared "approval session" abstraction with it, `transfer_sessions` and
`login_sessions`. Four instances is where generalisation starts to look
tempting, and these four still differ in exactly the places that matter: what is
snapshotted, what the terminal write is, and who may approve. The repeated
columns are cheap; a wrong abstraction over the gates is not.

| Column | Notes |
| --- | --- |
| `id` | `phone_<uuid>` |
| `started_by_user_id` | NOT NULL → `users`. The cookie's owner at request time. |
| `approved_by_user_id` | NULL → `users`. Who the wallet's `sub` resolved to. Only ever written equal to the above. |
| `old_phone` | NOT NULL. **A snapshot.** Half of what the holder signed. |
| `new_phone` | NOT NULL. The other half. |
| `foundry_verification_id` | NULL until the request is created. |
| `state` | `pending \| verified \| applied \| failed`, default `pending`. |
| `failure_reason` | NULL. Expiry is a reason, never a state. |
| `openid4vp_uri`, `request_uri` | NULL under either DC API transport. |
| `transport` | `request_uri \| dc_api \| dc_api_signed`, default `request_uri`. What foundry **actually served**, except on a `failed` row where it names what was attempted. |
| `dc_api_request_json` | foundry's inline request object, verbatim. |
| `dc_api_protocol` | foundry's protocol identifier, verbatim. Never derived. |
| `created_at` | The TTL is computed from this at read time. |

**There is no account id**, unlike `limit_change_sessions` and
`transfer_sessions`. The phone number is a property of the customer. That makes
`loadSession` scope two ways (id + `started_by_user_id`) rather than three.

**`phone_change_sessions` MUST be deleted in `seedWithin`.** It has a NOT NULL
FK to `users`, `createDb` sets `foreign_keys = ON`, and `seed()` deletes
`users` — so one abandoned attempt would otherwise make `pnpm seed` throw
partway through. Locally that is *every* attempt, because no local foundry
declares `sparkassen_auth`. It references only `users`, so it may go anywhere
before that delete; put it beside `limit_change_sessions`. `seed()` is already
wrapped in `db.transaction`, which is the real protection — do not rely on it.
Add a test that runs `seed()` with a phone-change row present.

### Storage format

The number is stored **exactly as the customer typed it, trimmed, with runs of
internal whitespace collapsed to a single space**. Nothing else. No stripping of
spaces, no E.164 canonicalisation, no re-grouping.

The payload, the column and the dashboard row are therefore the **same string**,
with no derivation between them. That is a deliberate contrast with the
transfer, which stores a normalised IBAN and derives the grouped display form —
there, grouping in fours is a deterministic, specified rule. There is no such
rule for a telephone number: German mobile grouping is conventional, varies by
prefix length, and a wrong guess shows the holder a number that does not look
like the one they typed.

The accepted cost, stated rather than coded around: `+49 171 5555555` and
`+491715555555` are different strings here. Nothing in this system compares two
numbers for equality except the stale-snapshot gate, which compares a stored
string against the same stored string, so the cost is never paid.

### Validation — `lib/phone-validation.ts`

`isValidPhoneNumber(value: unknown): value is string`, mirroring
`transfer-validation.ts`'s shape:

- trim and collapse whitespace first;
- must match `^\+[0-9](?:[0-9 ]*[0-9])?$` — a leading `+`, then digits and
  single spaces, ending in a digit;
- 7 to 15 digits once spaces are removed. 15 is E.164's maximum; 7 is the
  shortest thing worth calling a number.

The leading `+` is **required**, by decision. A demo whose entire point is a
human comparing two numbers on a screen should not also be asking them to
reconcile `0171 …` against `+49 171 …`. It is one regex over the collapsed
string, not a sequence of strips — the transfer's `parseAmountCents` records why
pre-stripping hides the thing you meant to reject.

Explicit non-goals of this function: no country-prefix table, no carrier lookup,
no check that the number is reachable, no check that it is a *mobile* rather
than a landline.

Separately, `startPhoneChange` refuses `phone_unchanged`. There is nothing to
confirm, and a consent screen showing one number twice is a defect. This is the
analogue of the limit dialog withholding the chip equal to the limit in force.

**That comparison is on DIGITS ONLY — author's call, and the one place in this
feature where the number is normalised.** Strip everything but `+` and the
digits from both sides and compare. Storage stays verbatim (above); only this
one predicate looks through the formatting.

Without it, retyping the same number without its spaces passes the gate, and the
consent screen then asks a human to approve a change from `+49 171 5555555` to
`+491715555555` — two renderings of one number, which is exactly the screen this
feature exists to make meaningful. The cost of the normalisation is one line and
it cannot leak into the payload, because it is used for a boolean and never for
a value that is stored or sent.

## The two DTOs

Spelled out because the success copy depends on them and the start route returns
one of them verbatim.

```ts
/** What the dialog needs to drive a handover, under the dialog's own prop names. */
export interface PhoneChangeSessionDto {
  sessionId: string;
  uri: string | null;          // null under either DC API transport
  transport: PresentationTransport;  // what foundry ACTUALLY served
  dcApiRequest: unknown;       // null under request_uri
  dcApiProtocol: string | null;// null under request_uri
  state: PhoneChangeSessionState;
  oldPhone: string;
  newPhone: string;
}

export interface PhoneChangeStatusDto {
  state: PhoneChangeSessionState;
  failureReason?: string;
  /**
   * Carried on the STATUS, not only on the start DTO. By the time the dialog
   * renders success the only thing it still holds is a session id, and the
   * success line names the number. `LimitChangeStatusDto` carries
   * `newLimitCents` for exactly this reason.
   */
  newPhone: string;
}
```

Note there is no `accountId` on either, unlike the limit change's.

## Routes

All four behind the session cookie, all scoped to the logged-in customer.

| Method & path | Does |
| --- | --- |
| `POST /api/profile/phone-change` | `startPhoneChange`. Body `{ phoneNumber, transport }`. **201** with the DTO straight through. |
| `GET /api/profile/phone-change/[sessionId]` | `refreshPhoneChangeState`. **200** or **404**. |
| `POST /api/profile/phone-change/[sessionId]/apply` | `applyPhoneChange`. **200**, **404**, **409** `not_verified`, **410** `already_applied`, **409** `phone_changed`, **410** `expired`. |
| `POST /api/profile/phone-change/[sessionId]/dc-api-response` | `relayPhoneChangeDcApiResponse`. |

`/api/profile/…` rather than `/api/accounts/[id]/…` because there is no account
in this flow. Do not invent one to match the limit change's URL shape.

Start-route failure mapping: `invalid_phone` → 400, `phone_unchanged` → 409,
`metadata_unavailable` → 502, `foundry_unavailable` → 502, `not_found` → 404.

**The start route returns the DTO straight through** —
`NextResponse.json(result.session, { status: 201 })` — never re-assembled from
its members, and `startPhoneChange`'s return type is **written out**, not
inferred. This repo lost `dcApiProtocol` at exactly this seam once (`6e997da`)
from an object literal a type could not check. Add the exact-key-set test on the
201 body: `JSON.stringify` silently drops `undefined`, which a type cannot catch.

## The ownership gate

`refreshPhoneChangeState` runs four gates, **in this order**:

1. foundry reports the presentation verified;
2. `extractAuthSubject` yields a `sub` — a pure read, which settles nothing;
3. `passedLoginBinding` — the `transaction_data` binding passed on the
   credential that answered the authenticator query;
4. that `sub` resolves to a `sparkassen_auth` credential whose `user_id`
   **equals** `started_by_user_id`.

Gate 2 sits between **reading** the `sub` and **resolving** it, deliberately.
Reading a claim out of a JSON blob is inert; turning it into a customer is the
act. The distinction is only observable in which `failure_reason` a verdict gets
when it is both unbound and carries an unmatched `sub` — pin it with a test
using a `sub` **no credential carries** plus a failing binding, the only input
where the two orderings differ.

Gate 4 **lives in the poll, not in apply**. Login resolves a `sub` to whoever
owns the credential, because nobody is signed in yet. Here somebody is, and
without this check any valid Sparkassen Authenticator presentation could change
any logged-in customer's number. In apply it would need a second
`getVerificationStatus` after the session had gone terminal and — worse — a
stranger's valid presentation would drive the session to `verified`, showing the
holder a success-shaped dialog that apply then rejects. `verified` must mean
*the right person approved*.

`wrong_customer` is its own reason, distinct from `unknown_credential`, so an
operator can tell a credential issued to the wrong person from one the bank
cannot place at all. The holder sees the same generic copy for both — spelling
out `wrong_customer` would tell whoever holds the phone that their presentation
was valid but for somebody else's account.

Not gated on `credential.state === "active"`, for the reason login is not:
foundry's verdict is the authority that the credential is real and
holder-bound; the row only answers *whose*.

A **thrown** `getVerificationStatus` leaves the session `pending`, not failed.
One transient 503 inside a five-minute window must not destroy an approval; the
client's consecutive-failure counter is what gives up.

## Apply

`applyPhoneChange` is synchronous, talks to foundry never, and re-checks only
what is local and could have moved: the caller still owns the session, the
window is still open, and **the stored number still equals `old_phone`**.

**The stale-snapshot gate comes BEFORE the guarded write.** `old_phone` is half
of what the holder signed. If the number moved underneath — two dialogs open —
writing `new_phone` anyway would honour an approval of a transition that is no
longer the one happening. Refusing *before* the `verified → applied` UPDATE
leaves the session claimable, so a refused apply does not burn the approval for
nothing; put the gate after it and one transient mismatch destroys the session.

The transition itself is a **guarded UPDATE** whose `.changes` decides the
winner, plus a compare-and-swap on `users.phone_number` whose zero-change result
throws to roll the transaction back. Both writes in **one** `db.transaction`:
without it a throw between them leaves the session `applied` with the number
unwritten, the retry answers 410, and the holder is told their change did not
happen with no way to make it happen.

`writes the number exactly once` must **move the stored number back** between
the two applies — leave it changed and the stale-snapshot gate refuses the
replay on its own, and the test would pass with the guarded UPDATE deleted.

Reasons: `not_found`, `not_verified`, `already_applied`, `expired`,
`phone_changed`.

`phone_changed` reaches the dialog **only** through a non-2xx apply response
body, never through the session's `failure_reason` — the poll structurally
cannot write it. `phoneFailureKey` must therefore take a plain string, and the
dialog must feed it `startError ?? applyError ?? value?.failureReason`, or that
copy is dead and a stale-snapshot refusal reads as the generic "could not be
verified".

## UI

### Where

A new `<section>` on `/`, **below Credentials and above Recent transactions**,
headed with a new `t.dashboard.profile` eyebrow (en *Your details*, de *Ihre
Daten*). Two rows inside one `.panel`:

- **Username** — `users.username`, plain text, no control. That is the
  **login** name (`anna`), confirmed by the requester, NOT the internal row id
  (`user_anna`). It is shown because it is the other fact a customer looks for
  in a details panel; it is immutable here and never leaves the page.
- **Mobile number** — the number, with a **Change** link in
  `var(--color-primary)`, styled exactly like `AccountLimitRow`'s.

The panel is a **server** component (`ProfilePanel.tsx`) reading a new
`getProfile(db, userId): { username, phoneNumber }` from `lib/queries.ts`. The
number must come off the server render, or `router.refresh()` cannot update it —
this is the same reason `AccountPanel` renders the limit itself and
`AccountLimitRow` carries only the control.

`PhoneNumberRow.tsx` is the `"use client"` boundary inside it, holding the
Change button and the dialog, mirroring `AccountLimitRow`. It takes
`dcApiForm` from the page, which already computes it.

**The Change control is NOT suppressed when the customer holds no Sparkassen
Authenticator**, for the reason `AccountLimitRow` documents at length:
`getAuthenticatorCredentialState` cannot tell a usable credential from an
unusable one, since one issued before the bank persisted `sub` reads as `active`
and can never satisfy the ownership gate. A suppression check would hide the
control from people who could use it and show it to people who cannot.

### The dialog

`PhoneChangeDialog.tsx`, structurally `LimitChangeDialog` with a text input in
place of the preset chips.

Form phase: title, lead, eyebrow **Mobile number**, one `<input type="tel">`
**pre-filled with the number in force**, a hint line, then Continue / Cancel.
One field rather than a read-only "current" line plus an empty "new" line — the
customer's own choice. The consequence is accepted and worth stating: the old
value disappears from the dialog as soon as they type, and the only place both
numbers appear together is the wallet, which is where the comparison is supposed
to happen.

Then the same four phases as the limit dialog, with `selectPhonePhase` in
`lib/phone-dialog-state.ts`. The first is named **`form`** rather than the limit
dialog's `choose`: this one asks for a value rather than offering a choice, and
two modules in the same codebase using one name for two different first screens
is how a reader starts assuming they are interchangeable. So:
`form | waiting | success | error`.

**`startFailed` must outrank `state === null`.** The limit change shipped this
bug once: checking `state === null` first made a failed start re-render the form
with no message anywhere — and locally that is *every* attempt, since no local
foundry declares `sparkassen_auth`. Pin it by name.

**`verified` is still `waiting`, not `success`.** No number changes until apply
returns 2xx, and apply can still refuse with `phone_changed`.

**QR recovery**: import `needsQrRecovery` from `limit-dialog-state.ts` and
`selectLoginAffordance` from `login-dialog-state.ts`. **`dcError` must NOT be
cleared** when the recovery session arrives — clearing it routes the affordance
straight back to the wallet button the holder just watched fail. `needsQrRecovery`
goes false on its own once the URI exists.

### Where the decisions live

Every vitest project here is `environment: "node"` with
`include: ["src/**/*.test.ts"]`, so **no `.tsx` file is covered by anything**.
Validation, phase selection, failure-key mapping and the Continue-enabled
predicate all live in `.ts` modules with their own tests. The `.tsx` files
render what those return and decide nothing.

Both new `.tsx` files therefore rest entirely on browser verification. Say so in
the commit message rather than implying the suite covers them.

### Copy

A new `profile` block (section heading, username label, mobile label) and a new
`phones` block in `MESSAGES`, both locales, keyed exactly like `limits`:
`change`, `dialogTitle`, `dialogLead`, `mobileNumber`, `hint`, `continue`,
`cancel`, `close`, `approveTitle`, `confirmInApp`, `openInWallet`, `scanCode`,
`qrAlt`, `waiting`, `preparing`, `walletUnavailable`, `showQrCode`,
`successTitle`, `successBody(number)`, `failedTitle`, `expired`,
`unknownCredential`, `phoneChanged`, `invalidPhone`, `phoneUnchanged`,
`verificationFailed`.

The failure strings are keyed by `phoneFailureKey`'s output, so a new reason
there is a compile error here rather than a dialog rendering nothing.
`verificationFailed` is the deliberate catch-all, covering `wrong_customer` and
`metadata_unavailable`.

`messages.test.ts` will likely add **zero** cases: its invariants (identical key
sets, no empty leaf, no German orthography in `en`, no leaf byte-identical
across locales) cover new leaves without new cases. `pnpm typecheck` is the real
gate for copy here.

## Operator dependencies

**None.** Verify that claim the way the limit change's was verified, before
building the UI: port-forward the deployed foundry's admin API to a **distinct**
port (9100, not 9000 — a local foundry may own `127.0.0.1:9000` while the
forward binds only `[::1]:9000`, and you will silently probe the wrong server),
then assert on the request object foundry **serves**, not on a 200:

1. the served `transaction_data` entry decodes **byte-exact** to what was sent,
   with `metadata` present and equal to the minted JWT;
2. the JWT is a 3-segment compact JWS, `typ: adhoc-transaction-metadata+jwt`,
   `transaction_data_type` equal to the entry's `type`, `exp - iat` = 900;
3. its echoed metadata carries both claims in consent order, **no `value_type`
   on either**, bare `en`/`de` on every display and all four `ui_labels`, and
   the `security_hint` verbatim in both;
4. a deliberately **bogus** `credential_ids` entry is **HTTP 400** — that is
   what makes the 200s evidence rather than serde dropping a field.

## Known-unverifiable

**No wallet has answered a phone-change presentation.** This flow sits on
exactly the same unverified leg as the limit change and the transfer.

What can be verified here, and should be: everything up to the handover —
foundry's served request object (above), the row each transport writes, the
dialog rendering a wallet button with no QR under the default transport and a QR
under `?dcapi=unsigned`, and the QR recovery path.

What cannot: whether a real wallet renders this two-claim screen, whether
`security_hint` is honoured verbatim, and whether `affirmative_action_label`
actually reads *"Confirm number"* on the device. The strongest prior available is
that El Paso accepted the limit change's ad-hoc JWT over the same `x5c` chain —
that settles PaSO §5.3's signature and credential-binding steps *for that
wallet*, and is not the same as having run this.

Nothing will have driven `refreshPhoneChangeState` past `pending` against a real
verdict, so **the ownership gate, the binding gate and `applyPhoneChange` will
be exercised only by the suite.** Say so plainly in the commit.

`?dcapi=unsigned` is the diagnostic to hand the operator. Note it also disables
the PaSO proof package, which is irrelevant here (no debit) but worth knowing.

## What is left to the builder

- Module names and file layout beyond the names used above.
- The exact German wording of the bank's own dialog copy, as long as the four
  consent-screen strings are as specified.
- The precise `successBody` phrasing.
- Whether `phone-validation.ts` is its own module or lives beside the session
  module. It should be its own, like `transfer-validation.ts`, but that is
  taste.
- The migration's file name (drizzle-kit chooses it).
- Test counts. **Measure; do not project.** Every plan in this repo that
  projected a total was wrong, and the bank's figure alone has drifted three
  times. Measure both ends when a count disagrees.