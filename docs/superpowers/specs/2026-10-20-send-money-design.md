# Send money — design

**Date:** 2026-10-20
**App:** `apps/bank`
**Status:** approved design, not yet planned

---

## 1 Intent

The bank can already issue credentials, log a customer in with one, and let one
approve a *non-payment* decision about an account (the daily limit change).
What it cannot do is move money.

This adds an outgoing bank transfer that the holder approves in their wallet.
The holder types a recipient, an IBAN, an amount and a purpose; the Sparkassen
Authenticator is asked to approve **those exact four values**, signed into
`transaction_data`; and only then is the account debited.

### Why now

Three things make this the right next feature rather than a bigger one.

- **It is the canonical SCA case.** Everything in this repo so far asks a wallet
  to prove something *about* a person. This asks it to authorise an act with a
  consequence, which is what strong customer authentication is for.
- **`daily_limit_cents` finally gates something.** `schema.ts` says, in as many
  words, "This GATES NOTHING. There is no transfer feature in this demo to
  enforce it against." After this, there is. The limit change stops being a
  demo of a number and becomes a demo of a control.
- **The ad-hoc metadata path is proven.** The limit change established that a
  bank-owned `transaction_data` type with a minted PaSO §5 metadata JWT renders
  in a real wallet, and that it needs **no foundry configuration change**. This
  reuses that mechanism unchanged.

### What it is not

It is not a payment. The merchant flow asks a stranger's wallet for a *payment
credential* and binds an amount to it. This asks *our own customer's*
authenticator to approve a transfer we will then perform ourselves. The
credential, the query, the transaction data type and the consent screen are all
different.

---

## 2 The flow

1. A **Send money** control sits on the account panel, beside the daily limit
   row. Any signed-in customer sees it.
2. Clicking it opens a dialog with four fields: **recipient name**, **recipient
   IBAN**, **amount**, **purpose**.
3. Pressing **Send** validates client-side, then POSTs to the bank. The server
   re-validates everything, refuses an over-limit or unaffordable transfer
   outright, mints the ad-hoc metadata JWT, and only then creates the foundry
   verification request.
4. The dialog hands off to the wallet over whichever transport the browser
   supports — DC API (signed by default), or QR / deep link.
5. The wallet shows a consent screen built from the minted JWT: amount,
   recipient, IBAN, purpose, plus a security hint it must print verbatim.
6. The browser polls. The poll drives `pending → verified | failed` and gates on
   the presented `sub` belonging to **the customer who is signed in**.
7. On `verified` the dialog POSTs to `…/apply`. That re-checks limit and
   balance, writes the debit and the transaction row in one database
   transaction, and moves the session `verified → applied`.
8. The dialog shows success. `router.refresh()` updates the balance, and the
   transfer appears in the transaction list as an ordinary debit.

---

## 3 Goals

1. A transfer the holder approves in their wallet actually moves money and shows
   up in the existing ledger.
2. The wallet consent screen shows all four values the holder typed, localised
   in English and German, rendered from an ad-hoc metadata JWT.
3. All three presentation transports work, with the same QR recovery the limit
   change has.
4. A transfer that exceeds the account's daily limit, or the account's balance,
   is refused — **before** the wallet is opened, and again before the debit.
5. Every user-facing string exists in both locales.

## 4 Non-goals

- **No recipient directory.** The IBAN is checked for shape and checksum and
  nothing else. There is no name/IBAN match, no bank lookup, no SEPA rails.
- **No credit side.** The recipient is external. Nothing is credited anywhere;
  the only row written is the sender's debit.
- **No cumulative daily tracking.** The limit is a cap on a *single* transfer,
  by explicit decision. Three €400 transfers against a €1,000 limit all succeed.
- **No scheduled, recurring or batch transfers.** One transfer, one approval.
- **No change to `apps/merchant`.** This feature is entirely within the bank.
- **No proof-package verification.** Design D4 stands: if a proof package is
  stored at all, nothing in the bank verifies it, and no copy may imply
  otherwise.
- **No revocation or cancellation** of an approved-but-unapplied transfer beyond
  the five-minute session TTL.

## 5 Anti-goals

These are the outcomes that would make this a failure even if it ran.

- **A `transaction_data` entry sent without `metadata`.** foundry accepts one at
  HTTP 200 (measured, for the limit change). The wallet then either refuses the
  whole presentation or renders raw claim names and an unformatted
  `"250.00 EUR"` to a human — which *looks like the feature working*. The mint
  must happen **before** the verification request, and a failed mint must abort
  the whole attempt.
- **A debit the holder did not approve**, or one for a different amount,
  recipient or purpose than the consent screen showed. The payload and the
  database row must come from one source.
- **A stranger's authenticator approving the signed-in customer's transfer.**
  Any valid `sparkassen_auth` presentation is a valid presentation; only the
  ownership gate makes it *this customer's* approval.
- **Two debits from one approval.**
- **A dialog that fails silently.** The limit change shipped this bug once: a
  failed start rendered the chooser again with no message anywhere. An error
  message is better than a dialog that looks idle.
- **Copy that claims the bank verified something it did not.**

---

## 6 Constraints

Everything here is already true of this repository and is repeated because
breaking any of it is how this feature fails. Read `AGENTS.md` first; these are
the ones this feature actually touches.

### 6.1 The amount string

The signed amount is `"250.00 EUR"` — **decimal number, space, ISO 4217 Alpha-3
code, in that order**. `toFixed`, never `Intl`. It is hashed byte-for-byte into
`transaction_data_hashes`, so a localised separator would make the signed
artefact depend on the browser's locale, and currency-first makes a conforming
parser read the amount as `"EUR"` and throw — a hard refusal of the whole
presentation under PaSO Core §7.4.2 step 2, not a label degrading to text. This
exact mistake broke every limit change on 2026-10-20.

**Builder's call, stated here so it is not discovered as a surprise:** the
existing `limitAmountString` in `lib/limit-transaction-data.ts` is to be
extracted to its own module (suggested: `lib/iso-currency-amount.ts`) and used
by both flows. This is now the third place in the repo that needs it, the rule
is subtle, the failure mode is a total wallet refusal, and a second copy could
only drift. The existing `limit-transaction-data.test.ts` must stay green
without modification — if it does not, the extraction was not behaviour-
preserving.

### 6.2 Locale tags

Both locales are always sent, regardless of the bank's current UI language, and
the tags are **bare `en` and `de`** — the shortest tag naming the language,
never `en-US`/`de-DE`. RFC 4647 Lookup only ever *shortens* a user's range, so a
region tag is strictly less reachable; with region tags, phones on `en-GB`,
`de-AT`, `de-CH` or bare `en` select no locale at all, and PaSO View §4 is
all-or-nothing, so that refuses the **entire** presentation. Measured against
El Paso's own `LocaleSelector`.

### 6.3 `value_type`

Per PaSO Proof Metadata §3.1 and PaSO View §3:

- `value_type` is **optional**; when omitted the value is treated as plain text
  and **must** be a string.
- `value_type` **must not** be used on a claim with no `display` array.
- A wallet **shall exclude** an entry whose declared `value_type` it does not
  support, or whose payload does not conform to it.

Therefore: **`amount` carries `value_type: "iso_currency_amount"`; the other
three claims carry no `value_type` at all.** Do not invent one for the IBAN.
Declaring an unsupported type is not a cosmetic risk — it excludes the entry.

### 6.4 The mint

- `ttl_secs: 900`, stated explicitly. foundry's default is 300s, which is
  *exactly* the session TTL, and the JWT is minted after the row is written — so
  a holder approving at T+295 would be handed a JWT with seconds left, and a
  §5.3 `exp` failure is indistinguishable from the holder pressing Cancel.
- `transaction_data_type` in the mint request **must equal** the entry's own
  `type`.
- **A 2xx is not a successful mint.** `FoundryClient.request` does
  `JSON.parse(text) as T` and throws only on a non-2xx or non-JSON body, so a
  200 carrying `{}` leaves `jwt` undefined with nothing raised, and
  `JSON.stringify` then silently drops `metadata` from the entry. Check
  `typeof minted.jwt === "string" && minted.jwt.length > 0` at runtime.

### 6.5 Transport

- The **response** decides the transport, never the request. A foundry too old
  to know `dc_api_signed` does not reject it — it falls through to
  `direct_post.jwt` and answers with a URI and no inline request object. Treat
  the DC API as usable only when a `dc_api_request` **and** a protocol came back.
- Use `isDcApiTransport`, never `transport === "dc_api"`. The equality test
  misses `dc_api_signed` and renders a QR of an empty string.
- `needsQrRecovery` applies here unchanged: a DC API session has no URI, so a
  wallet failure needs a **new** `request_uri` session. **Do not clear `dcError`
  when that session arrives** — clearing it routes the affordance straight back
  to the wallet button that just failed. `needsQrRecovery` goes false on its own
  once the new session carries a URI.

### 6.6 Decisions live in `.ts`

Every vitest project is `environment: "node"` with `include:
["src/**/*.test.ts"]`. A `.tsx` file is covered by nothing. Validation, phase
selection, terminal detection, failure-key mapping and the payload builder all
belong in `.ts` modules with their own tests; the dialog renders what they
decide.

### 6.7 The database

- **The new table must be deleted in `seed()`**, before `accounts` and `users`,
  or `pnpm seed` throws partway through on the foreign keys. `seed()` is already
  wrapped in `db.transaction`, which is what keeps a mistake here from
  destroying the demo — do not unwrap it.
- All money is integer cents. Column names end in `_cents`.
- Read `drizzle-kit generate`'s output before committing it. This repo has twice
  received an unrunnable table rebuild whose `INSERT … SELECT` names a column
  the old table does not have. Apply the migration to a real SQLite file first.

### 6.8 Routes

A route handler's JSON body is a hand-maintained projection and is the seam this
project has already lost a field in. The 201 body **is** the session DTO, passed
through from a function carrying a **written-out return type annotation**. Do
not assemble an object literal; do not infer the return type.

---

## 7 The design

### 7.1 `transfer_sessions`

A new table, modelled directly on `limit_change_sessions` and deliberately
**not** generalised into a shared "approval session" abstraction with it and
`login_sessions`. Three instances of a pattern is where generalisation starts to
pay, and these three differ in exactly the places that matter (what is
snapshotted, what the terminal write is, who may approve).

| Column | Notes |
| --- | --- |
| `id` | `transfer_<uuid>` |
| `started_by_user_id` | NOT NULL → `users`. The session cookie's owner at request time. |
| `approved_by_user_id` | → `users`, NULL until the poll's gate runs. Only ever written **equal to** `started_by_user_id`. |
| `account_id` | NOT NULL → `accounts` |
| `payee_name` | NOT NULL. Trimmed. |
| `payee_iban` | NOT NULL. **Normalised**: whitespace stripped, upper-cased. |
| `amount_cents` | NOT NULL, integer cents, `> 0` |
| `purpose` | NOT NULL. Trimmed. |
| `foundry_verification_id` | nullable |
| `state` | `pending \| verified \| applied \| failed`, default `pending` |
| `failure_reason` | nullable |
| `openid4vp_uri`, `request_uri` | nullable |
| `transport` | the transport **served**, not the one requested |
| `dc_api_request_json`, `dc_api_protocol` | nullable |
| `transaction_id` | → `transactions`, NULL until applied |
| `created_at` | integer ms |

Two columns for the user, as in `limit_change_sessions`, for the same reason:
"who asked" and "who approved" are distinct facts, and the gate that makes this
safe is precisely that they must be equal.

There is **no `expired` state.** Expiry is a failure reason computed from
`created_at` at read time, because nothing in this project runs a background
sweep.

**There is no amount snapshot column**, and the absence is deliberate. The limit
change snapshots `old_limit_cents` because it is half of what the holder signed
over. Here everything the holder signed is already a column. The limit and the
balance are *not* signed — they are preconditions, re-checked at apply rather
than compared against a snapshot.

`TRANSFER_SESSION_TTL_MS = 5 * 60 * 1000`, matching the other two flows.

### 7.2 The transaction data

```
type:            urn:paso:sca:dev.digitallabor:transfer:1
credential_ids:  [SPARKASSEN_AUTH_QUERY_ID]
transaction_data_hashes_alg: ["sha-256"]
payload:
  amount:      "250.00 EUR"
  payee_name:  "Max Mustermann"
  payee_iban:  "DE89 3704 0044 0532 0130 00"
  purpose:     "Rent October"
metadata:        <the minted JWT>
```

`credential_ids` is `SPARKASSEN_AUTH_QUERY_ID` — the **DCQL query id**, which
deliberately shares a spelling with the credential type constant and is
deliberately a separate constant. foundry validates this list against the
resolved named query and 400s on an unknown id.

**The IBAN is sent grouped in fours, not normalised**, via the existing
`formatIban`. This is a builder-visible call: the payload is what the holder
*reads* on the consent screen, and the entire point of that screen is that they
can compare it against what they typed. `formatIban` strips and regroups, so it
is deterministic and the hash is stable. The database stores the normalised
form; the payload is derived from it at build time, so there is one source and
one derivation.

Claim order on the consent screen is **amount, recipient, IBAN, purpose** —
amount first because it is the number a defrauded person needs to notice.
(The dialog's field order is entry order: recipient, IBAN, amount, purpose. The
two orders serve different jobs and are allowed to differ.)

**Claim metadata** — `display` in both bare locales, `value_type` only on
`amount`:

| path | `value_type` | en | de |
| --- | --- | --- | --- |
| `amount` | `iso_currency_amount` | Amount | Betrag |
| `payee_name` | *(omitted)* | Recipient | Empfänger |
| `payee_iban` | *(omitted)* | Recipient IBAN | Empfänger-IBAN |
| `purpose` | *(omitted)* | Purpose | Verwendungszweck |

**`ui_labels`** — all four, in both locales:

| key | en | de |
| --- | --- | --- |
| `transaction_title` | Approve this transfer | Überweisung freigeben |
| `affirmative_action_label` | Confirm transfer | Überweisung bestätigen |
| `denial_action_label` | Cancel | Abbrechen |
| `security_hint` | Sparkasse will never ask you to transfer money to a new account. | Die Sparkasse wird Sie niemals bitten, Geld auf ein neues Konto zu überweisen. |

The `security_hint` is the one label that says something the four values do not,
and it matters more here than it did for the limit change. Authorised push
payment fraud *is* this screen: a fraudster talks a victim through their own
bank's UI to a transfer the victim authorises themselves. PaSO §3.2 requires the
wallet to display this string exactly as provided and forbids altering or
removing it — so the bank's warning cannot be dressed up by whatever is driving
the browser.

**Two places hold user-facing transfer copy and they answer to different
authorities.** `MESSAGES[locale].transfers` is the bank's own dialog; the
consent screen's strings live in the minted JWT. Do not unify them.

### 7.3 Validation

Client-side for the affordance, **server-side for the truth**. A logged-in
caller with `curl` is the real input surface, so the route trusts a tested
predicate rather than the dialog — the same doctrine as `isValidNewLimit`. Every
rule fails closed.

- **Amount.** Accepts `.` or `,` as the decimal separator (a German UI will be
  typed `250,00`), at most two fractional digits, no grouping separators.
  Converts to integer cents. Must be a positive integer number of cents and
  within a sane ceiling. Rejects `NaN`, infinities, negatives and zero.
- **IBAN.** Strip whitespace, upper-case, then: `^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$`
  and the ISO 13616 mod-97 check must equal 1. **Nothing else** — no country
  length table, no bank directory, no name match. The checksum is in because it
  is ten lines and it catches exactly the typo this screen exists to prevent.
- **Recipient name.** Non-empty after trimming, at most 70 characters (the SEPA
  limit).
- **Purpose.** Non-empty after trimming, at most 140 characters (the SEPA
  remittance limit). Required rather than optional: it is a row on the consent
  screen, and an empty one renders as a blank.

### 7.4 The two money gates

Checked in `startTransfer`, **before** the mint and before foundry:

- `amountCents > account.dailyLimitCents` → refuse, `limit_exceeded`
- `amountCents > account.balanceCents` → refuse, `insufficient_funds`

Refusing here rather than later is the whole point: there is no reason to ask a
human to approve something the bank has already decided to reject, and no reason
to spend an ad-hoc mint on it.

Both are **re-checked in `applyTransfer`**, because either can have moved during
the wallet round trip — and note that one of them can move *because of this
app*: a limit change running in another tab can lower the limit underneath a
transfer in flight. A re-check failure leaves the session **claimable** rather
than consumed, exactly as the limit change's stale-snapshot gate does, so a
transient refusal does not burn the holder's approval.

The balance gate reuses `processPayment`'s existing `insufficient_funds`
vocabulary. A transfer that overdrew while a card payment could not would be the
odd one out.

### 7.5 The poll and the ownership gate

`refreshTransferState` mirrors `refreshLimitChangeState` exactly, including the
ordering, which is load-bearing:

1. terminal → no traffic
2. expiry → no traffic, writes `expired`
3. already verified → no traffic
4. foundry reports the presentation verified
5. `extractAuthSubject` yields a `sub` — a pure read, which settles nothing
6. `transaction_data_binding` passed on the credential that answered the
   authenticator query
7. that `sub` resolves to an authenticator credential owned by
   `started_by_user_id`

Steps 5 and 6 are in that order deliberately: reading a claim out of a JSON blob
is inert; the gate belongs before the claim is *used*, not before it is read.

**Step 7 is the gate this flow adds, and it lives in the POLL, not in apply.**
Without it any valid Sparkassen Authenticator presentation could approve any
signed-in customer's transfer. Putting it in apply would need a second
`getVerificationStatus` after the session had gone terminal and — worse — would
let a stranger's valid presentation drive the session to `verified`, showing the
holder a success-shaped dialog that apply then rejects. `verified` must mean
*the right person approved*.

`wrong_customer` is its own failure reason, distinct from `unknown_credential`,
so an operator can tell the two apart. The holder sees the same generic copy for
both: naming `wrong_customer` would tell whoever is holding the phone that their
presentation was valid but for somebody else's account.

### 7.6 Apply

A **POST**, not part of the poll, because a GET with a side effect gets fired
twice by a prefetch or a double-poll and here the side effect moves money.

Order:

1. load the session scoped to `(userId, accountId, sessionId)` — ownership is
   checked here, not in the route, because a route is one caller of many
2. `applied` → `already_applied` (410); anything but `verified` → `not_verified`
3. expiry → `expired`
4. re-check limit and balance (§7.4)
5. **one database transaction** over: the guarded `verified → applied` UPDATE,
   the balance decrement, and the `transactions` insert

The guarded UPDATE's `.changes` is what decides the winner — a read-then-write
would let two concurrent applies both proceed. **Belt and braces:** the
`transactions` row is inserted with `idempotency_key = <session id>`, and that
column already carries a unique index. So single-debit is enforced by the
database as well as by the state machine, and the two mechanisms fail
independently.

The transaction row:

- `amount_cents`: **negative** (it is a debit; the ledger's convention)
- `counterparty`: the recipient name
- `reference`: the purpose
- `credential_id`: the authenticator's resolved `sub`, the way a card payment
  records the credential that authorised it
- `idempotency_key`: the session id
- `booked_at`: now

`transfer_sessions.transaction_id` is written in the same transaction, so a
session and its debit can never disagree about whether it happened.

### 7.7 Modules

New, all under `apps/bank/src/`:

- `lib/iso-currency-amount.ts` — the extracted amount string (§6.1)
- `lib/transfer-validation.ts` — amount parsing, IBAN normalise + mod-97, field
  limits, and the server-side `isValidTransferRequest` predicate
- `lib/transfer-transaction-data.ts` — the type constant, the ad-hoc metadata
  request builder, the entry builder. Sibling of `limit-transaction-data.ts`,
  and kept apart from the session module for the same reason: one builds what is
  sent, the other reads what came back
- `lib/transfer-sessions.ts` — `startTransfer`, `refreshTransferState`,
  `applyTransfer`, `relayTransferDcApiResponse`
- `lib/transfer-dialog-state.ts` — `TransferPhase`, `selectTransferPhase`,
  `isTransferTerminal`, `transferFailureKey`. Imports `selectLoginAffordance`
  and `needsQrRecovery` rather than copying them
- `components/SendMoneyRow.tsx` — the client boundary inside `AccountPanel`,
  mirroring `AccountLimitRow`
- `components/SendMoneyDialog.tsx`
- `app/api/accounts/[id]/transfer/` — `route.ts` (POST start),
  `[sessionId]/route.ts` (GET poll), `[sessionId]/apply/route.ts` (POST),
  `[sessionId]/dc-api-response/route.ts` (POST relay), plus a `segments.ts`
  mirroring the limit-change one

Changed: `db/schema.ts`, `db/seed.ts`, `lib/queries.ts` (if the panel needs
anything new), `lib/i18n/messages.ts` + `en.ts` + `de.ts`, `components/AccountPanel.tsx`,
and a new `drizzle` migration.

### 7.8 Copy

A new `transfers` block in `Messages`, declared once and implemented in both
catalogs — a missing key is a **compile** error, which is the real gate for copy
here, since `messages.test.ts`'s invariants cover new leaves without new cases.

Failure copy is keyed by the `failure_reason` values `transfer-sessions.ts`
actually writes. Only the reasons the holder can act on name a remedy:

| key | reached by |
| --- | --- |
| `expired` | `expired` |
| `unknownCredential` | `unknown_credential` — names the remedy: re-add the authenticator |
| `limitExceeded` | `limit_exceeded` |
| `insufficientFunds` | `insufficient_funds` |
| `verificationFailed` | everything else, including `wrong_customer`, `metadata_unavailable`, `transaction_data_binding_failed`, `foundry_unavailable` |

### 7.9 The control is not suppressed

The **Send money** control is shown whether or not the customer holds a
Sparkassen Authenticator, for the same reason the limit change's Change control
is: `getAuthenticatorCredentialState` cannot tell a usable credential from an
unusable one. A credential issued before the bank began persisting `sub` reads
as `active` and can never satisfy the ownership gate — there is no backfill — so
a suppression check would hide the control from people who could use it and show
it to people who cannot. The `unknownCredential` copy names the exact remedy and
the authenticator tile is on the same page.

---

## 8 Verification

`pnpm check` must be green. TDD throughout: write the failing test, run it,
confirm it fails for the right reason, then implement.

**What the suite structurally cannot cover**, and must therefore be verified in
a real browser with `tools/cdp`:

- both new `.tsx` files, in full
- the dialog's QR recovery after a DC API failure
- the progress through all five faces

**What needs the deployed foundry**, not a local one: the local
`../foundry/config.yaml` declares neither `sparkassen_auth` nor the named query,
so **every local attempt fails visibly** — which is itself worth seeing once,
since it is the anti-goal's error path. Verify the request leg against
`https://foundry.digitallabor.dev`. Port-forward the admin API to a **distinct**
port (9100, not 9000) or you will silently probe a local instance and read its
401 as a bad key.

Specifically, assert on the request object foundry serves rather than on a 200:

- the `transaction_data` entry decodes to the exact payload sent, with
  `metadata` present and a 3-segment compact JWS
- the minted JWT's `transaction_data_type` equals the entry's `type`, `exp - iat`
  is 900, and both `en`/`de` pairs survive in every `display` and `ui_label`
- a deliberately bogus `credential_ids` is HTTP 400 — so the 200 is evidence
  rather than serde dropping a field
- an entry with `metadata` deliberately omitted is accepted at 200, confirming
  that the bank's own ordering is the only thing preventing the anti-goal

## 9 Known-unverifiable

**No wallet can be exercised from this environment.** No phone, no EUDI wallet
app. Everything from the handover onward is unobserved:

- whether a real wallet renders this consent screen at all, and whether it looks
  like §7.2 describes
- whether `iso_currency_amount` is implemented or falls back to rendering
  `"250.00 EUR"` raw
- whether the four-claim layout is readable on a phone
- whether `security_hint` is honoured verbatim
- the entire `verified → applied` path against a real verdict: the ownership
  gate, the binding gate and `applyTransfer` are exercised only by the suite

One real wallet (El Paso) has accepted the limit change's ad-hoc JWT, which
settles PaSO §5.3's signature and credential-binding steps **for that wallet**
and for the same `x5c` chain this flow uses. That is the strongest prior
available and it is not the same as having run this.

`?dcapi=unsigned` is the diagnostic to hand an operator: it is the same flow
over the previously exercised unsigned wire form, so a wallet that succeeds
there and fails by default has localised the problem to the signature.

Do not claim any of this works until a human with a device has run it.

---

## 10 Left to the builder

- Task decomposition and ordering; test counts (measure, never project — this
  repo's plans have been wrong about that every time).
- The exact markup, spacing and Tailwind of both components, within the existing
  `panel` / dialog idiom.
- Whether **Send money** sits beside the limit row or above it on the account
  panel.
- Whether the dialog validates per-field on blur or on submit.
- The ceiling on the amount field.
- Whether a proof package is stored for a transfer. The merchant→bank path has
  one; this path has no merchant and no webhook arriving for it, so the simplest
  correct answer is **no package**, and `transaction_proofs` stays a
  merchant-payment artefact. Revisit only if a reason appears.