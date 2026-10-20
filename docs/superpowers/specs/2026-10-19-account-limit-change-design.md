# Changing an account's daily transfer limit, approved in the wallet

Design document. 2026-10-19.

## Intent, and the why

This repo already proves the EUDI wallet can be a *payment instrument*. This
adds a second, different proof: that the wallet can approve a **non-payment
decision about an account**, with the decision itself rendered on the wallet's
consent screen in the bank's own words.

The payoff moment — stated by the person who asked for this, and the thing every
decision below serves — is the consent screen in the wallet reading:

```text
Current Account Limit: 1000 EUR
New Account Limit:     2000 EUR

Cancel        Confirm Limit Change
```

Everything in the bank UI is scaffolding to reach that screen and to show the
number afterwards. If a choice makes that screen worse, it is the wrong choice.

The mechanism is PaSO Proof Metadata §5, **ad-hoc transaction data metadata**:
the bank mints a short-lived, issuer-signed JWT describing how to render *this*
transaction data type, and embeds it in the `transaction_data` entry it sends.
That is what turns a payload of two opaque strings into the screen above,
without any wallet or foundry configuration knowing about limit changes in
advance.

## What exists already, and is reused unchanged

- **`sparkassen_auth`** — the Sparkassen Authenticator credential. Attests "this
  is an authenticated customer of this bank" and carries exactly one claim,
  `sub`. The wallet-login flow already requests it through foundry's
  `sparkassen_auth` named query and already resolves a `sub` back to a customer.
- **`transaction_data` on a non-payment approval** — `login-transaction-data.ts`
  already sends `urn:paso:sca:dev.digitallabor:login:1` with a `login_datetime`
  payload, and `login-checks.ts` already *gates* on foundry reporting
  `transaction_data_binding` as passed. The limit change is the same shape with
  a different payload and one new member.
- **The wallet handover dialog** — `WalletLoginDialog` already does the whole
  transport dance: signed DC API by default, `?dcapi=unsigned` opt-out, QR
  fallback, poll, cancel. The limit-change dialog's second step is this,
  reskinned, not reinvented.
- **foundry's ad-hoc mint endpoint** — `POST /admin/paso/ad-hoc-metadata` is
  already implemented (`crates/foundry/src/server.rs`,
  `crates/foundry-issuer/src/paso_metadata.rs`). It takes
  `{ credential_type_id, transaction_data_type, metadata?, ttl_secs? }` and
  returns `{ jwt, exp }`. It is **live on the deployed foundry** and this
  design's exact payload has been minted against it — see §"Operator
  dependencies: none".

Nothing about payments, the merchant app, or the proof package is touched.

## Goals

1. A logged-in customer can see each account's daily transfer limit on the
   dashboard and change it, with the change approved in their wallet.
2. The `transaction_data` sent to the wallet carries claims named exactly
   **`old_limit`** and **`new_limit`**.
3. The entry carries a PaSO §5 ad-hoc metadata JWT, minted per request, which
   supplies the claim labels and the consent screen's title and button text in
   both English and German.
4. A change takes effect only when foundry reports the presentation verified
   **and** `transaction_data_binding` passed on the authenticator credential.

## Non-goals

- **Nothing enforces the limit.** There is no transfer feature in this demo to
  enforce it against. The number is displayed and changed; it gates nothing.
- **No history.** No ledger row, no audit table, no record of previous limits.
  The only evidence a change happened is that the number is different.
- **No stored proof package.** `transaction_proofs` exists for merchant
  settlements and is not extended here.
- **No free-entry amount.** Four presets only (see below).
- **No change to the wallet-login flow**, its type identifier, its checks, or
  its dialog. The limit change is a sibling, not a generalisation. Refactoring
  login and limit-change into one shared "approval session" abstraction is
  explicitly out of scope — there are two instances, which is one too few.

## Anti-goals

Things that would make this a failure even if it worked:

- **A limit that changes without the wallet's approval.** If the flow ever
  degrades to "the wallet was unavailable, so we applied it anyway", the demo
  proves nothing. Every failure path leaves the limit untouched.
- **A consent screen that falls back to raw claim names.** If the ad-hoc
  metadata cannot be minted, the request must not be sent at all. A wallet
  showing `old_limit: 1000.00 EUR` to a human is worse than an error message,
  because it looks like the feature working.
- **Copy that claims the bank verified something it did not.** The bank checks
  foundry's verdict; it does not verify signatures itself. Same rule the proof
  dialog already follows.

## The flow

1. Dashboard. Each `AccountPanel` gains one row below the balance: *Daily
   transfer limit — 1.000,00 €*, and a **Change** link.
2. **Change** opens a dialog: the current limit, four preset chips, Cancel and
   Continue. The preset equal to the current limit is not selectable.
3. **Continue** → `POST /api/accounts/{id}/limit-change` with the chosen
   amount. The server:
   a. reads the account (ownership-checked), rejects a new limit equal to the
      current one or outside the preset set;
   b. writes a `pending` limit-change session row **before** calling foundry, so
      a refusal leaves a visible `failed` row — the property `startIssuance`,
      `startLoginSession` and `startPaymentSession` all rely on;
   c. mints the ad-hoc metadata JWT from foundry;
   d. creates the verification request, carrying one `transaction_data` entry;
   e. records the transport foundry **actually served**, soft-falling back to
      `request_uri`, exactly as `startLoginSession` does.
4. The dialog becomes the wallet handover — in-browser wallet button on a
   capable device, QR otherwise — and polls roughly every 2s.
5. The holder sees the consent screen above and confirms.
6. The poll observes `verified` with the binding check passed; the client then
   applies, and the dialog shows *Limit changed — your daily transfer limit is
   now 2.000,00 €*. The account panel behind it shows the new number.
7. Anything else leaves the limit exactly as it was, with a plain reason and the
   option to try again.

## The `transaction_data` entry

Type identifier: **`urn:paso:sca:dev.digitallabor:limit-change:1`**

It follows PaSO Core §5.2's `urn:paso:sca:<domain>:<suffix>:<version>` form and
reuses the `dev.digitallabor` domain the login type already uses. foundry
validates this shape at mint time; hyphens in the suffix are permitted (the
validator constrains only emptiness and the version segment).

```json
{
  "type": "urn:paso:sca:dev.digitallabor:limit-change:1",
  "credential_ids": ["sparkassen_auth"],
  "transaction_data_hashes_alg": ["sha-256"],
  "payload": {
    "old_limit": "1000.00 EUR",
    "new_limit": "2000.00 EUR"
  },
  "metadata": "<compact adhoc-transaction-metadata+jwt>"
}
```

Notes, each of which is a decision:

- `credential_ids` is `["sparkassen_auth"]` — the **DCQL query id**, reusing
  `SPARKASSEN_AUTH_QUERY_ID`, not the credential type constant. foundry
  validates this list against the resolved named query and 400s on an unknown
  id. The two constants deliberately share a spelling and are deliberately
  separate.
- The payload is sent as **plain JSON**. foundry performs the OpenID4VP §8.4
  base64url encoding itself; a pre-encoded value here would be double-encoded.
- **~~Amount format is `"EUR 1000.00"` — ISO currency code, space, plain
  decimal with two places. This mirrors PaSO's own example (§A.4 uses
  `"EUR 45.00"`).~~ SUPERSEDED 2026-10-20 — the order is BACKWARDS and the
  citation is fabricated.**

  There is no `"EUR 45.00"` anywhere in PaSO. paso-view §3 defines the type in
  one sentence, quoted verbatim because a paraphrase is what went wrong here:

  > The value is a string consisting of a decimal number (integer part, decimal
  > point, fractional digits per [ISO4217]) followed by a space and an
  > [ISO4217] Alpha-3 currency code (e.g., `"49.99 EUR"`).

  paso-core §A.4's own rendering shows `49.99 EUR`. **Amount first, currency
  code last.** The correct value is `"1000.00 EUR"`.

  Measured: a real wallet refused every limit change outright with
  `VALUE_TYPE_MISMATCH — claim 'old_limit' is not an '<amount> <ISO4217>'
  string`. A consumer parses on the last space, so currency-first makes the
  amount parse as `"EUR"` and throw — and because §7.4.2 step 2 settles
  `value_type` conformance during entry *selection*, that is a hard refusal of
  the whole presentation rather than one label degrading to plain text.

  The rest of the original reasoning stands and is why the string is written by
  hand at all: it is **locale-neutral on purpose**, because it is hashed
  byte-for-byte into `transaction_data_hashes`, so baking a German thousands
  separator into it would make the signed artefact depend on the browser's
  locale. The wallet localises it, via `value_type` — confirmed against a real
  wallet's formatter, which renders `2000.00 EUR` as `$2,000.00` under `en-US`
  and `2.000,00 €` under `de-DE`.
- `transaction_data_hashes_alg` is stated explicitly even though foundry would
  insert its configured value, for the same reason the login entry states it:
  the entry should be self-describing where it is constructed.

Both the values are derived from integer cents held in the database. Conversion
to the decimal string happens **only at this boundary**, with `toFixed`, never
`Intl` — the same rule the merchant's `transaction_data.amount` already follows.

## The ad-hoc metadata JWT

Minted per request by `POST /admin/paso/ad-hoc-metadata`:

```json
{
  "credential_type_id": "sparkassen_auth",
  "transaction_data_type": "urn:paso:sca:dev.digitallabor:limit-change:1",
  "metadata": {
    "claims": [
      {
        "path": ["old_limit"],
        "mandatory": true,
        "value_type": "iso_currency_amount",
        "display": [
          { "locale": "en-US", "name": "Current Account Limit" },
          { "locale": "de-DE", "name": "Aktuelles Kontolimit" }
        ]
      },
      {
        "path": ["new_limit"],
        "mandatory": true,
        "value_type": "iso_currency_amount",
        "display": [
          { "locale": "en-US", "name": "New Account Limit" },
          { "locale": "de-DE", "name": "Neues Kontolimit" }
        ]
      }
    ],
    "ui_labels": {
      "transaction_title": [
        { "locale": "en-US", "value": "Change your account limit" },
        { "locale": "de-DE", "value": "Kontolimit ändern" }
      ],
      "affirmative_action_label": [
        { "locale": "en-US", "value": "Confirm Limit Change" },
        { "locale": "de-DE", "value": "Limitänderung bestätigen" }
      ],
      "denial_action_label": [
        { "locale": "en-US", "value": "Cancel" },
        { "locale": "de-DE", "value": "Abbrechen" }
      ],
      "security_hint": [
        {
          "locale": "en-US",
          "value": "Sparkasse will never ask you to raise your limit."
        },
        {
          "locale": "de-DE",
          "value": "Die Sparkasse wird Sie niemals bitten, Ihr Limit zu erhöhen."
        }
      ]
    }
  }
}
```

Decisions:

- **The metadata override is what makes this work at all.** PaSO §5.4 says a
  type covered by a valid ad-hoc JWT is "considered supported … even if it is
  absent from the signed credential metadata", and foundry implements exactly
  that: with an override present it never consults the credential type's
  configured `transaction_data_types`. So **no foundry config change is needed**
  for the limit-change type to exist. Without the override, foundry 400s with
  "does not declare transaction data type … and no metadata override was
  supplied".

  That claim is no longer an argument from the spec — it is **measured**, and in
  the cleanest possible form. `sparkassen_auth` *is* a PaSO Credential on the
  deployed foundry: it is the only configuration in
  `/.well-known/openid-credential-issuer` carrying a `credential_metadata_uri`,
  and that document (served at
  `https://foundry.digitallabor.dev/credential-metadata/sparkassen_auth`)
  already declares a `transaction_data_types` map — holding exactly one entry,
  `urn:paso:sca:dev.digitallabor:login:1`, with the login flow's own claims and
  `ui_labels`. So the limit-change type is a type **absent from a credential
  metadata document that exists**, which is the literal case §5.4 is written
  about. Nothing has to be added to foundry's config and no credential already
  in a holder's wallet has to be re-issued.

  That deployed login entry is also the closest thing to a reference
  implementation available, and this design follows it: region-tagged locales,
  a `value_type` on the claim, and a `security_hint`.
- **Minted fresh per limit-change request**, not cached. The JWT is a pure
  function of two constants and foundry's signing key, so caching it for its
  whole TTL would be correct and would save one admin call. It is not done
  because a cache is a second thing that can be stale in a demo, and the
  saving is one HTTP call on a flow a human drives by hand. *(My call.)*
- **`ttl_secs` is sent explicitly as `900`** (15 minutes). An earlier draft left
  it unset and justified that by saying foundry's default outlives one wallet
  handover. It does not comfortably: the default is `300` seconds, which is
  *exactly* the limit-change session TTL below, and the JWT is minted after the
  session row is written — so a holder approving at T+295 hands the wallet a
  metadata JWT with seconds left. A §5.3 `exp` failure and a holder pressing
  Cancel are indistinguishable from the bank's side, so that race would be
  undiagnosable. 900 is comfortably longer than any session that can still be
  alive, and nothing caches the JWT, so a long TTL costs nothing. It also makes
  the deployed `issuer.paso_metadata.adhoc_ttl_secs` irrelevant, which matters
  because that value is not readable from here and could itself be below 300.
  **Measured:** the deployed foundry honours `ttl_secs: 900` exactly —
  `exp - iat` is 900 and the echoed `exp` agrees with the signed one.
  *(My call, correcting an earlier one.)*
- **Both locales are always sent**, regardless of the bank's current UI locale.
  The wallet picks by its *own* locale priority list, which the bank cannot
  observe — sending only the bank's current locale would show a German-phone
  holder an English screen. PaSO §5.4 notes that a wallet MAY treat an entry
  with no compatible locale as incompatible, which makes this a correctness
  issue rather than a nicety.
- **~~The locale tags are `en-US` and `de-DE`, not bare `en` and `de`.~~
  SUPERSEDED 2026-10-19 — this was WRONG and it broke every real presentation.**

  The original reasoning: every locale tag the deployed foundry publishes is
  region-tagged, so matching that is the conservative choice, because "a wallet
  doing RFC4647 lookup degrades `de-DE` to `de` but is not obliged to promote
  `de` to `de-DE`".

  That second clause is a correct description of RFC4647 §3.4 and the exact
  opposite of the conclusion to draw from it. Lookup only ever **shortens** the
  user's language range, so a region-tagged entry is strictly *less* reachable
  than a bare one: `en-US` can be matched only by a user whose range is already
  `en-US`, while `en` is matched by `en`, `en-US`, `en-GB`, `en-IE` and every
  other variant. "Conservative" pointed the other way the whole time.

  Measured against El Paso's `LocaleSelector`: with `en-US`/`de-DE` only, phones
  set to `en-GB`, `de-AT`, `de-CH`, bare `en` or `fr-FR` all selected **no**
  locale. PaSO View §4 is all-or-nothing, so that refuses the entire
  presentation rather than degrading one label — the holder sees *"Transaction
  can't be displayed"* and the limit change cannot proceed at all. That wallet's
  own last-resort fallback is bare `en`, which also missed.

  **The tags are now bare `en` and `de`.** The deployed foundry accepts them
  (HTTP 200) and echoes them unchanged. They coincide with this repo's own
  `Locale` values, which is a coincidence and not a derivation: the rule is
  "the shortest tag that names the language", which is what makes an entry
  reachable from the most ranges.
- Every label is well inside §3.3's limits (60 for a claim display name, 100 for
  `transaction_title`, 40 for either action label). foundry enforces these at
  mint time and returns 400, so an over-long German string is a build-time
  failure, not a silent truncation.
- **`security_hint` is present**, reversing an earlier draft that omitted it
  for having "nothing true and useful to say". Reading the deployed login entry
  showed that reasoning was wrong twice over. It sets a precedent — the login
  type carries *"Never share your online banking credentials."* — and, more to
  the point, raising a transfer limit is a standard step in an authorised push
  payment scam, where the fraudster talks the victim through the bank's own UI.
  So there *is* something true and useful here that the two amounts do not say:
  **"Sparkasse will never ask you to raise your limit."** The wallet must
  display it verbatim and may not alter or remove it (§3.2), which is exactly
  the property wanted — the bank's warning cannot be dressed up by whatever is
  driving the browser. *(My call.)*
- `denial_action_label` is **accepted and echoed by the deployed foundry** —
  measured, not inferred: the minted JWT's `metadata.ui_labels` carries it back
  with both locales intact. (It is also named explicitly in `ui_label_max_len`
  with a 40-grapheme limit, and `ui_labels` keys are not allow-listed at all —
  an unrecognised key falls through to a 100-grapheme default.) So the
  "Cancel" half of the consent screen is under the bank's control at mint time.
  Whether a *wallet* honours it is a separate question and is not.
- `iso_currency_amount` as a `value_type` is **accepted** by the deployed
  foundry and echoed on both claims. That is a validator result, not evidence
  that any wallet implements the type — see Known-unverifiable.

## Failure of the mint is failure of the whole request

If `POST /admin/paso/ad-hoc-metadata` returns non-2xx or is unreachable, the
limit-change session is marked `failed` and **no verification request is
created**. This is the anti-goal above made concrete: a `transaction_data` entry
with no `metadata` and a type no credential's metadata declares puts the wallet
in PaSO Core §7.4.2 "incompatible" territory, where the best case is a refusal
and the worst case is a consent screen showing raw claim names. Neither is worth
having instead of an error message.

## Data

### `accounts.daily_limit_cents`

A new column on the existing `accounts` table: `integer`, NOT NULL, DEFAULT
`100000` (1.000,00 €). Integer cents, like every other money column here.

Per-account, not per-customer — stated directly by the person who asked. A
customer with two accounts sees two rows and changes them independently.

This is a **real migration** (`ALTER TABLE accounts ADD COLUMN …`), unlike the
`credential_type_id` and `transport` widenings this repo has done before — those
were TypeScript-only claims about untyped text columns. Read `drizzle-kit
generate`'s output before committing it: this repo has twice had it emit a table
rebuild whose `INSERT … SELECT` names the new column on both sides, which is
unrunnable. Apply it to a real SQLite file before committing.

The seed sets an explicit value rather than relying on the DEFAULT, so the
demo's starting number is visible in the fixtures.

### `limit_change_sessions`

A new table, modelled directly on `login_sessions` — same transport columns,
same soft-fallback discipline, same reasons:

| column | notes |
| --- | --- |
| `id` | `limit_<uuid>` |
| `started_by_user_id` | FK, NOT NULL. Who opened the dialog. |
| `approved_by_user_id` | FK, nullable. Written at verify time. See below. |
| `account_id` | FK. Which account's limit. |
| `old_limit_cents` | Snapshot at request time. What was signed over. |
| `new_limit_cents` | What was signed over. |
| `foundry_verification_id` | Nullable until foundry answers. |
| `state` | `pending \| verified \| applied \| failed` |
| `failure_reason` | Nullable. |
| `openid4vp_uri`, `request_uri` | As `login_sessions`. |
| `transport` | `request_uri \| dc_api \| dc_api_signed`. What foundry **served**. |
| `dc_api_request_json`, `dc_api_protocol` | As `login_sessions`. |
| `created_at` | For the TTL. |

`old_limit_cents` is **snapshotted**, not re-read at apply time. It is part of
what the holder signed over; if the account's limit changed underneath (two
dialogs open), applying against a stale snapshot would honour an approval of a
transition that is no longer the one happening. The apply step therefore
re-reads the account and **fails** if the current limit no longer equals
`old_limit_cents`. *(My call. The looser alternative — apply `new_limit_cents`
regardless — is defensible but silently discards what the holder was shown.)*

**The two user columns are deliberately two.** `login_sessions.user_id` is
nullable and means the *resolved* identity — `refreshLoginSessionState` writes it
at verify time and `claimLoginSession` reads it back — because at login time
nobody is signed in yet. Here somebody is, so there are two distinct facts, and
reusing one column for both would silently conflate them. `started_by_user_id`
is written at step 3b from the session cookie; `approved_by_user_id` is written
by the poll, from the `sub` the wallet disclosed.

`verified` and `applied` are separate states for the same reason `login_sessions`
splits `verified` from `consumed`: collapsing them makes "the wallet approved"
indistinguishable from "the limit was written", and that distinction is the
whole of what makes the session single-use.

There is no `expired` state. Expiry is a failure reason computed from
`created_at` at read time, because nothing in this project runs a background
sweep. TTL: **5 minutes**, matching `LOGIN_SESSION_TTL_MS`.

## Routes

All of these are behind the existing session cookie (`withSession`). Unlike the
wallet-login routes, which are necessarily unauthenticated, **every route here
is authenticated and scoped to the logged-in user.**

- `POST /api/accounts/{id}/limit-change` — start. Body `{ newLimitCents }`.
  Returns the sheet/dialog's own prop shape, produced by a **named function with
  a written-out return type annotation**, not a hand-written object literal.
  This repo has lost a member at exactly this seam before (the merchant's
  `dcApiProtocol`); the annotation is the guard that catches it and the inferred
  return type is not.
- `GET /api/accounts/{id}/limit-change/{sessionId}` — poll. Drives
  `pending → verified | failed`. Reads foundry. Never writes the limit.
- `POST /api/accounts/{id}/limit-change/{sessionId}/apply` — applies the new
  limit and moves `verified → applied`. A POST and not the poll, for the reason
  the login flow uses a POST to mint its cookie: a GET with a side effect gets
  fired twice by a prefetch or a double-poll, and here the side effect writes to
  an account. Idempotent via the `applied` state.
- `POST /api/accounts/{id}/limit-change/{sessionId}/dc-api-response` — relays
  the browser's DC API response to foundry, mirroring the wallet-login relay.
  Must keep that relay's `!response.ok` guard: `fetch` does not throw on a
  non-2xx, and without the guard a 500 counts as success and strands the dialog.

A session id that does not exist, is not this user's, or is not for this
account, answers **404** in all three cases — indistinguishable, for the same
reason `GET /api/transactions/{id}/proof` is.

## The ownership gate

This is the part that is easy to get subtly wrong, and it is new relative to
wallet login.

Wallet login resolves a `sub` to *whoever* owns that authenticator credential —
that is the whole point, nobody is logged in yet. Here, somebody **is** logged
in, and the approval must come from *their* authenticator.

**The identity gate lives in the poll, not in apply.** The poll is what talks to
foundry, so it is where the verdict is available; putting the gate in apply
would need a second `getVerificationStatus` call after the session had already
gone terminal — and, worse, a *stranger's* valid authenticator presentation
would drive the session to `verified` and show the holder a success-shaped
dialog that apply then rejects. `verified` must mean *the right person
approved*, or the state name is a lie. So the poll requires all of:

1. foundry reports the presentation `verified`;
2. `transaction_data_binding` passed **on the credential that answered the
   `sparkassen_auth` query** (reuse `passedLoginBinding` — it is already scoped
   that way and already fails closed on absence);
3. `extractAuthSubject` yields a `sub`;
4. that `sub` matches a `credentials` row with
   `credential_type_id = 'sparkassen_auth'` **owned by `started_by_user_id`**.

Only then does the row become `verified`, with `approved_by_user_id` written.
Anything else is `failed` with a named reason. Note (4) in particular: without
the owner check, any valid Sparkassen Authenticator presentation could approve
any logged-in customer's limit change.

The **apply** step then re-checks only what is local and could have moved since:

- the request's session cookie still belongs to `started_by_user_id`;
- the account named by the session is owned by that user;
- the account's current limit still equals `old_limit_cents`.

All of this fails closed and leaves the limit untouched.

A credential issued **before** the bank started persisting `sub` has an
unrecoverable join key and can never satisfy (4). There is no backfill. This is
the same limitation wallet login already has and the copy should not pretend
otherwise.

## UI

### Where

Inside `AccountPanel`, below the balance, separated by a rule. Chosen from three
options shown as mockups; the reasoning given was that the limit is a property
of the account, so it belongs on the account's own panel, and nothing new
appears on the dashboard.

`AccountPanel` is a server component. The new row introduces a client boundary —
a small client component holding the Change link and the dialog, receiving the
account id and the current limit as props. Keep the formatting of the displayed
amount in the existing `splitEuroCents` / format helpers rather than inventing a
second one.

### The dialog

Three steps, mocked and accepted:

1. **Choose.** Current limit; four preset chips — **500 €, 1.000 €, 2.000 €,
   5.000 €** (my numbers; the seed default is 1.000 €); Cancel and Continue. The
   chip matching the current limit is not selectable, so Continue can never send
   a no-op. Presets rather than a free amount was chosen explicitly: nothing can
   be mistyped on stage, and there is no validation copy to write at all.
2. **Approve.** The existing wallet handover, unchanged in behaviour: the
   in-browser wallet button when the DC API is available, the QR otherwise,
   `?dcapi=unsigned` honoured the same way, cancel available throughout.
3. **Done.** A confirmation naming the new limit.

The step-2 recovery path from `WalletLoginDialog` carries over: a DC API session
cannot be re-rendered as a QR, so "show QR code" means *create a new
`request_uri` session*, not re-render the existing one.

### Where the decisions live

The dialog's rendering decision goes in a **`.ts` file**, not in JSX — a
`sheet-state.ts` / `login-dialog-state.ts` equivalent. Every vitest project here
is `environment: "node"` with `include: ["src/**/*.test.ts"]`, so a branch
inside a `.tsx` file is never covered by anything. Likewise the preset list, the
"is this chip selectable" rule, and the cents-to-`"0.00 EUR"` conversion are all
plain functions with their own tests.

### Copy

A new `limits` block in **both** locale catalogs, `en` and `de`. A key present in
one and missing from the other is a compile error, so `pnpm typecheck` is the
real gate for copy here — `messages.test.ts`'s invariants (identical key sets, no
empty leaf, no leaf byte-identical across locales) cover new leaves without
needing new cases.

Note that the wallet's consent screen copy is **not** in these catalogs. It
lives in the ad-hoc metadata JWT, is sent in both locales at once, and is chosen
by the wallet. Two places hold user-facing strings about limit changes and they
answer to different authorities; do not try to unify them.

The locale *tags* happen to coincide with this app's `Locale` values (`en` /
`de`) since the correction above, but they are still not derived from them: the
JWT always carries BOTH languages regardless of the UI locale, because a
`Locale`-keyed lookup feeding the JWT would send a single locale, which is the
one thing §5.4 warns can make the entry incompatible. The rule for the tags
themselves is "the shortest tag that names the language" — see the superseded
region-tag decision above for what happens otherwise.

## Operator dependencies: none. Measured 2026-10-19

An earlier draft of this document made the ad-hoc mint endpoint an open
operator question. It is not one. Every part of it was probed against the
deployed system and came back green, so the builder starts with no blocker and
no ticket to file.

What was measured, and how:

1. **`sparkassen_auth` is a PaSO Credential.**
   `GET https://foundry.digitallabor.dev/.well-known/openid-credential-issuer`
   shows it as the **only** configuration carrying `credential_metadata_uri`.
   `GET /credential-metadata/sparkassen_auth` returns a document whose
   `transaction_data_types` holds the login type — so there is a credential
   metadata document for the limit-change type to be absent *from*, which is
   the precise case PaSO §5.4 licenses.
2. **The issuer signing key and its `x5c` are configured.** Requesting that same
   URL with `Accept: application/jwt` returns **HTTP 200**,
   `content-type: application/jwt`, header
   `{"alg":"ES256","typ":"credential-metadata+jwt","x5c":[…]}`. This matters
   beyond §4: `build_adhoc_metadata_jwt` and the §4 route share one
   `signer_and_chain(cfg)`, so a served §4 JWT rules out the
   unset-`issuer.credential_signing_key` failure outright.
3. **The ad-hoc mint route is live on the deployed build.** The admin API is
   **not** on the public listener — `foundry.digitallabor.dev/admin/*` answers
   404 for *every* admin path, including ones that certainly exist, so a 404
   there proves nothing. It is served at **`https://foundry-admin.digitallabor.dev`**.
   `POST /admin/paso/ad-hoc-metadata` answers **401** unauthenticated and
   **200** with the admin key, which is what distinguishes "route present" from
   "route absent".
4. **This design's exact payload mints.** Not a reduced probe — the full
   `metadata` block above, both claims, all four `ui_labels`, both locales,
   `ttl_secs: 900`. Response `{ jwt, exp }`, and the decoded JWT reads:

   | field | value |
   | --- | --- |
   | `typ` | `adhoc-transaction-metadata+jwt` ✓ §5.2 |
   | `alg` | `ES256`, `x5c` 1 cert |
   | `iss` | `https://foundry.digitallabor.dev` |
   | `sub` | `https://creds.digitallabor.dev/vct/sparkassen_auth` |
   | `format` | `dc+sd-jwt` |
   | `transaction_data_type` | `urn:paso:sca:dev.digitallabor:limit-change:1` ✓ equals the entry's `type` |
   | `exp - iat` | 900, and the echoed `exp` agrees with the signed one |

   The `metadata` echo keeps both `iso_currency_amount` value types, both
   `en-US`/`de-DE` display pairs, and all four `ui_labels` keys including
   `denial_action_label` and `security_hint`.
5. **The §5.3 credential binding holds trivially.** The ad-hoc JWT's `x5c` chain
   is **byte-identical** to the one on the credential-metadata JWT — leaf
   `CN=Foundry issuer_sdjwt`, issuer `CN=Foundry Root CA
   (foundry.digitallabor.dev)`. Same leaf, same Subject, same root. `iss` also
   matches the credential issuer identifier. Steps 5 and 6 of §5.3 therefore
   cannot fail for structural reasons; what remains is whether a wallet trusts
   that root at all, which is a trust-store question, not a configuration one.

Reproduce with:

```bash
KEY=$(kubectl -n foundry get secret foundry-admin \
  -o jsonpath='{.data.admin-api-key}' | base64 -d)
curl -s -X POST https://foundry-admin.digitallabor.dev/admin/paso/ad-hoc-metadata \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d @adhoc-request.json
```

Two traps worth keeping. Do **not** probe `foundry.digitallabor.dev/admin/…` —
its blanket 404 reads as "endpoint missing" when it means "admin is not public".
And if you reach for a port-forward instead, follow this repo's existing
warning: a local foundry may own `127.0.0.1:9000` over IPv4 while
`kubectl port-forward` binds only `[::1]:9000`, so forward to a **distinct**
port (`9100:9000`) or you will silently probe the local instance.

The local `../foundry/config.yaml` declares neither `sparkassen_auth` nor the
`sparkassen_auth` named query, so **none of this flow is exercisable against a
local `pnpm dev`**. It will take `startLimitChange`'s failure path every time, as
wallet login already does. Point `FOUNDRY_*` at the deployed instance to
exercise it.

## Known-unverifiable

Stated plainly, because this repo's convention is to.

No wallet in this environment can exercise any of it. There is no phone and no
EUDI wallet app. Note what that does **not** cover any more: the mint endpoint,
the JWT's structure, the signing chain and the metadata echo are all measured
facts now (see the section above), not hopes. The remaining unknowns are
narrower and sit entirely past the handover.

What can be verified here, and should be:

- the `transaction_data` entry as foundry serves it to the wallet — fetch the
  request object from `request_uri` and confirm the entry decodes byte-exact to
  what was sent, **including the `metadata` member**, against a DCQL query whose
  only credential id is `sparkassen_auth`. foundry models `transaction_data` as
  raw JSON values, so the member should pass through, but "should" is not
  "did";
- a deliberately bogus `credential_ids` entry returning 400, so the 200 above is
  evidence rather than serde silently dropping a field;
- the whole bank-side flow in real headless Chrome via `tools/cdp`, up to and
  including the wallet button being rendered and **clicked** — note that this
  repo has previously verified "renders the wallet button" and mistaken it for
  "the wallet button works".

What cannot be verified here, and must be said as unverified in the commit:

- whether a real wallet accepts the ad-hoc metadata JWT at all. Four of §5.3's
  steps are now structurally settled — `typ`, `iss`, `transaction_data_type`
  and the credential binding all check out above — which leaves two that this
  environment genuinely cannot answer: whether the signature verifies in the
  wallet's own crypto, and whether the wallet's **trust store** contains
  `CN=Foundry Root CA (foundry.digitallabor.dev)`. A demo wallet configured for
  this issuer will have it; a stock production wallet will not, and will reject
  the metadata. Either way it fails *inside the wallet, with no server-side
  trace*: from the bank's side, a rejected metadata JWT and a holder pressing
  Cancel are the same event.
- whether a real wallet understands the `iso_currency_amount` value type, or
  falls back to rendering the raw `"2000.00 EUR"`. The latter is survivable; the
  fallback is to drop `value_type` and send pre-formatted text, at the cost of
  baking a locale into a hashed payload.
- whether the consent screen actually looks like the one at the top of this
  document. That is the whole feature, and it can only be confirmed by a human
  with a device.

No wallet has ever answered the `sparkassen_auth` query in any flow, so this
feature inherits every unknown wallet login already has, and adds §5.3 on top.

## What is left to the builder

- Test counts. Measure them; do not project them. This repo's plans have been
  wrong about this every single time.
- File and function names beyond the few named above, and whether
  `limit-change-state.ts` is one module or two.
- Whether the four presets live in the i18n catalogs (as formatted strings) or
  as cents in a `.ts` constant formatted at render. Prefer the latter — the
  amounts are data, not copy — but it is a judgment call.
- The exact German wording, beyond the consent-screen labels fixed above.
- Whether the Change link is suppressed when the customer holds no
  `sparkassen_auth` credential at all. Suppressing it is friendlier; showing it
  and failing clearly is more honest about what the demo needs. Either is
  defensible; pick one and say why in the commit.
- Migration file name — `drizzle-kit` generates it.