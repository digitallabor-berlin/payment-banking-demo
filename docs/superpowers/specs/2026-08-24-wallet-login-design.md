# Login with EUDI-Wallet — design

**Date:** 2026-08-24
**Status:** approved, not implemented
**Scope:** `apps/bank` only. No merchant change, no `packages/*` change.

## 1. What this adds

A second way to authenticate to the bank's online banking: presenting a
`sparkassen_auth` credential from a wallet instead of typing a password. The
login screen gains one button, **Login with EUDI-Wallet**.

This makes the bank a **verifier** for the first time. Until now it has been an
issuer only — it calls `POST /admin/issuance/offers` and polls issuance status,
and has never touched foundry's verification API. The merchant is the only app
in this repo that verifies, so its `payment-sessions.ts` / `checks.ts` pair is
the model followed throughout, deliberately and with its reasoning carried over
rather than re-derived.

### Out of scope

- Any change to the merchant.
- Registering a wallet as a second factor *alongside* a password. This replaces
  the password for one login; it does not augment it.
- Rate limiting, and binding a login session to the browser that started it.
  See §7.
- Making a wallet login distinguishable from a password login after the fact.
  Decided against: see §6.5.

## 2. What was verified before designing this

Everything in this section was read off a real file or a real service. Nothing
here is inferred from documentation.

### 2.1 The named query exists and discloses what we need

`~/dev/dl-infra-k8s/foundry/foundry_config.yml:1230` — the **deployed** foundry:

```yaml
- id: sparkassen_auth
  dcql:
    credentials:
      - id: sparkassen_auth
        format: dc+sd-jwt
        meta:
          vct_values: ["https://creds.digitallabor.dev/vct/sparkassen_auth"]
        claims:
          - path: [sub]
```

Two properties matter and both hold:

- **No `credential_sets`.** Under OpenID4VP 1.0 §6 every credential query is
  therefore mandatory, so a conformant wallet must answer this one. The verdict
  reports `requested_credentials_answered` rather than
  `credential_sets_satisfied` — the opposite of `payment`/`payment_av`. No code
  here reads either key, so this is a fact to know, not a dependency.
- **The DCQL credential query id is also `sparkassen_auth`.** The named query
  and its single credential query share a spelling. They are different
  registries and their agreeing is a coincidence of this config, not a rule —
  §5.2 keeps them as two named constants for that reason.

### 2.2 The credential type guarantees `sub` is disclosed

`foundry_config.yml:462`:

```yaml
- id: sparkassen_auth
  format: dc+sd-jwt
  vct: https://creds.digitallabor.dev/vct/sparkassen_auth
  validity_seconds: 31536000
  cryptographic_holder_binding: true
  claims:
    - path: [sub]
      required: true
      selectively_disclosable: false
```

- `required: true` + `selectively_disclosable: false` means `sub` is **always**
  present in a presentation. The holder cannot withhold it, and there is no
  branch where a verified verdict carries no subject.
- `validity_seconds: 31536000` is **365 days**. This corrects a claim in the
  root `AGENTS.md` that credentials in this demo "expire on their 12-hour
  lifetime" — that is not true of this type, and a login credential that
  expired in 12 hours would make the feature close to useless.
- `cryptographic_holder_binding: true`, and the deployment's `status_list` is
  enabled, so a presentation carries a real signature check and a real
  `status_check`. That is what licenses §5.3's decision not to require the
  local row to be `active`.

### 2.3 The blocker was on our side, and it is one field

`apps/bank/src/lib/authenticator-issuance.ts` mints `sub: randomUUID()`, sends
it to foundry, and **never persists it**. That was deliberate — both
`AGENTS.md` files record it as "nothing about it is correlatable across
issuances". The consequence is that today a valid `sparkassen_auth`
presentation proves *"the holder has a Sparkassen Authenticator this bank
issued"* and cannot say **which customer**.

Login requires exactly that link, so the `sub` must be persisted. §4.2 states
the trade precisely and §4.3 states what it costs.

### 2.4 The DC API origin list does not include the bank

`foundry_config.yml:867`:

```yaml
dc_api_expected_origins: ["https://foundry-admin.digitallabor.dev", "https://larder-shop.digitallabor.dev"]
```

Over the DC API transport the KB-JWT audience MUST be the browsing-context
Origin. The bank's origin, `https://sparkasse-musterstadt.digitallabor.dev`, is
absent. See §8.1 — this is an external dependency, not a code defect, and it
degrades to a **silent decline** rather than an error.

### 2.5 Nothing about this works against a local foundry

`../foundry/config.yaml` declares three credential types (`pid`,
`com.emvco.dpc.card`, `eu.europa.ec.av.1`) and three named queries (`over18`,
`payment-age-loyalty`, `over18_mdoc`). It has neither `sparkassen_auth` the
credential type nor `sparkassen_auth` the named query. A local `pnpm dev` will
therefore produce a visible `failed` login session on every attempt — the same
position the merchant has been in since `payment`/`payment_av` landed.

## 3. Architecture

### 3.1 Why a session table rather than proxying foundry

The same reason the merchant has `payment_sessions`: our state is a **superset**
of foundry's. foundry knows `pending | verified | failed`. We additionally need
to know *whose* login this resolved to, and whether a cookie has already been
minted from it. Neither is a question foundry can answer.

### 3.2 How the cookie reaches the browser — the one real choice

A cookie can only arrive on an HTTP response, so the shape of that response is
the design's central decision. Three were considered.

**A — the poll sets the cookie.** `GET /api/auth/wallet-login/{id}` returns
`{state}` and, on the tick it transitions to `verified`, also `Set-Cookie`.
One round trip and no extra route.

*Rejected.* A GET that mints an authenticated session is a side-effecting read.
Worse, single-use consumption then rides on a request that browsers and
frameworks feel free to repeat — a prefetch, a double-poll, or React StrictMode
in development consumes the session with no user action.

**B — the poll reads, a separate `POST …/claim` mints. CHOSEN.** The poll is a
pure read. When it reports `verified` the client POSTs to claim, receives `200`
plus `Set-Cookie`, and navigates. Consumption is explicit and happens on a verb
that is allowed to mutate; a second claim is `410`.

The cost is one extra round trip at the very end of a flow that has already
spent seconds waiting for a human to approve something in a wallet. That is not
a cost worth optimising.

**C — the DC API relay returns the cookie inline.** For same-device there is
already a POST carrying the wallet's response; it could mint the session
directly and skip the poll entirely for that transport.

*Rejected on this repo's own precedent.* The merchant's `dc-api-response` route
returns **204 and discards foundry's `VerificationResult`**, and `AGENTS.md`
records why: "the verdict reaches the UI through the poll that is already
running, so there is one state path rather than two." Minting a session on the
relay for same-device and on `claim` for cross-device would be precisely the two
paths that rule exists to prevent, and the two would drift. The relay here
returns 204 for the same reason.

### 3.3 State machine

```text
pending ──► verified ──► consumed
   │            │
   └────────────┴──────► failed
```

- **`pending`** — a foundry verification request exists; no verdict yet.
- **`verified`** — foundry returned `verified`, the gate passed, and a `user_id`
  has been resolved and written. **Nothing has been minted.**
- **`consumed`** — a session cookie has been issued from this row. Terminal.
- **`failed`** — terminal, with a `failure_reason`.

`verified` and `consumed` are separate states for the same reason the merchant
splits `verified` from `settling`: collapsing them makes "the credential checked
out" indistinguishable from "someone already got a session out of this", and
that distinction is the whole of what makes the session single-use.

**Expiry is computed, never scheduled.** There is no background job anywhere in
this project and this design does not add one.
`refreshLoginSessionState(db, foundry, sessionId, now)` compares
`createdAt + LOGIN_SESSION_TTL_MS` against `now` before doing anything else and,
when it has passed, writes `state = 'failed'` with
`failure_reason = 'expired'`. `expired` is a **reason, not a state** — the
state column holds four values and this is not a fifth. The parameter is named
`now` rather than `_now` — unlike the merchant's, it is actually read, and
`noUnusedParameters` is what makes that distinction visible.

Expiry is checked before the foundry call, so an abandoned session stops
generating admin-API traffic once its window closes.

## 4. Data

### 4.1 New table: `login_sessions`

Migration `0002`. A plain `CREATE TABLE` with no table rebuild, so it should not
reproduce the `INSERT … SELECT` defect that made `0001` unrunnable — but
`drizzle-kit generate`'s output is to be **read before committing** regardless,
per the standing rule.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | `login_<uuid>` |
| `foundry_verification_id` | text | null until foundry answers |
| `state` | text | `pending \| verified \| consumed \| failed`, default `pending` |
| `openid4vp_uri` | text | null under `dc_api` |
| `request_uri` | text | null under `dc_api` |
| `transport` | text | `request_uri \| dc_api`, default `request_uri` |
| `dc_api_request_json` | text | foundry's inline unsigned request object, verbatim |
| `user_id` | text → `users.id` | resolved at `verified`; NULL before |
| `failure_reason` | text | |
| `created_at` | integer | |

`transport` is **recorded rather than inferred**, for the merchant's stated
reason: `openid4vp_uri IS NULL` is ambiguous between a `dc_api` session and a
foundry failure.

As with every other `text` enum in this project, the drizzle `enum:` is a
TypeScript claim about the data and not a database CHECK constraint.

The row is written **before** foundry is called, so a failed
verification-request creation leaves a visible `failed` row rather than nothing
at all — the property both `startIssuance` and `startPaymentSession` rely on.

### 4.2 `credentials`: no schema change

`sub` is persisted into the **existing** nullable `credential_id` column. That
column already carries three different things — the DPC's `dpc_`-prefixed
`credential_id`, and `psu_id` for `sparkassencard` and `wero` — because there is
one lookup either way, which is the whole reason it is not per-format. A
`sparkassen_auth` `sub` is a fourth value in the same role: the thing the wallet
discloses that resolves back to a row.

It carries a UNIQUE index (`credentials_credential_id_unique`), so uniqueness is
free, and SQLite permits many NULLs, so every existing age/authenticator row is
unaffected.

`authenticator-issuance.ts` therefore changes by exactly one field: the `sub` it
already mints and already sends is now also written to the row it already
inserts.

### 4.3 What persisting `sub` costs — accepted deliberately

- **Unchanged:** `sub` is still a fresh `randomUUID()` per issuance. Two
  authenticator credentials issued to the same person carry different values, so
  no third party can correlate them to each other. The privacy property the
  original decision was protecting survives intact.
- **Changed:** the **bank** can now link a presentation back to the issuance row
  and therefore to a customer. That is inescapably what "log me in as Anna"
  requires.
- **Cost, permanent:** any `sparkassen_auth` credential already in a wallet has
  an unrecoverable `sub` and **cannot be used to log in**. Such a holder must
  add the credential again. This is a rule, not a one-off migration step — no
  backfill is possible, because the value was never stored. In practice this is
  expected to affect zero real credentials, since nothing has yet successfully
  issued one against the deployed foundry.

The `AGENTS.md` statements that this credential is "never persisted" and
"nothing about it is correlatable across issuances" must both be corrected when
this ships. The second remains true of third parties and false of the bank.

## 5. The gate

### 5.1 Where it lives

`apps/bank/src/lib/login-checks.ts`, pure functions with their own test file,
mirroring `apps/merchant/src/lib/checks.ts`. Pure so it is testable: every
vitest project is `environment: "node"` with `include: ["src/**/*.test.ts"]`.

### 5.2 The sequence

1. `verdict.state === "verified"` **and** `verdict.result?.verified === true`.
   Otherwise `failed` / `verification_failed`.
2. Find the presented credential whose **`query_id === SPARKASSEN_AUTH_QUERY_ID`**
   (`"sparkassen_auth"`). Never "the first credential in the array", never
   "whichever one carries a `sub`".

   This is the same rule as the merchant's `PAYMENT_JOIN_KEY_CLAIM`, and it is
   load-bearing for the same reason: a claim-name collision must never decide
   who gets logged in. `sub` is a claim name that `sparkassencard` and `wero`
   also carry. Today this query requests only one credential, so a fallback
   chain would be *observationally* equivalent — the rule exists so that
   widening the query later cannot silently turn a payment credential's `sub`
   into an authentication subject.
3. Read `sub` from that credential's `claims`. It must be a non-empty string.
   Otherwise `failed` / `verification_failed`.
4. Resolve `credentials` where `credentialId = sub` **AND**
   `credentialTypeId = 'sparkassen_auth'`. The type predicate is redundant
   against the UNIQUE index — no `psu_id` can equal a `sub` and both be stored —
   but it makes the read state its intent rather than rely on that.
5. No matching row → `failed` / `unknown_credential`. This is the §4.3
   pre-existing-credential case, and it is the expected outcome for any
   credential issued before this ships.
6. The row's `userId` is written to `login_sessions.user_id` and the state
   becomes `verified`. **`displayName` is deliberately not stored** on the
   login session — `claimLoginSession` re-reads it from `users` at claim time,
   so a display name edited between verification and claim cannot be served
   stale, and the login session holds no copy of user data it does not need.

### 5.3 What is deliberately NOT checked

- **That the credential row is `active`.** foundry's verdict is the authority
  that the credential is real, correctly signed, holder-bound and unrevoked
  (§2.2). The local row exists only to answer *whose*. A row still `offered`
  because a status poll was abandoned — which nothing in this project ever
  clears — must not block a login for a credential demonstrably in the wallet.
  This is the same reasoning that produced `pickLiveCredential`, applied to a
  different question.
- **`transaction_data`.** It binds an *amount* to a presentation. There is no
  amount here, so there is nothing to bind and the request carries none.

## 6. Surface

### 6.1 Routes

All four are **unauthenticated by necessity** — the caller is by definition not
logged in yet.

```text
POST /api/auth/wallet-login
     body { dcApi?: boolean }
     201 { sessionId, uri, transport, dcApiRequest, state }
     502 foundry_unavailable

GET  /api/auth/wallet-login/[id]
     200 { state, failureReason? }     pure read; polls foundry
     404 not_found

POST /api/auth/wallet-login/[id]/claim
     200 { userId, displayName } + Set-Cookie: bank_session
     404 not_found
     409 not_verified      (still pending, or failed)
     410 already_consumed

POST /api/auth/wallet-login/[id]/dc-api-response
     body { response: string }
     204                                (verdict reaches the UI via the poll)
     404 / 502
```

`GET …/[id]` polls foundry as a side effect of being read, exactly as the
merchant's status route does — "pure read" above means *it does not mint a
session*, not that it performs no I/O.

**`claim` is never the source of the failure message the user sees.** A session
that failed reports `409 not_verified`, which does not say *why*; the reason
reaches the dialog through the poll, which is the one path that carries
`failureReason`. The 409 exists to close the race where a claim is sent against
a session that changed state after the poll read it — it is a guard, not a
channel. `claim` is only ever called after a poll has already reported
`verified`.

### 6.2 Modules

| Path | Purpose |
| --- | --- |
| `src/lib/login-sessions.ts` | `startLoginSession`, `getLoginSessionStatus`, `refreshLoginSessionState`, `claimLoginSession` |
| `src/lib/login-checks.ts` | the §5 gate, pure |
| `src/lib/login-dialog-state.ts` | the dialog's rendering decision |
| `src/lib/dc-api-relay.ts` | mirror of the merchant's |
| `src/lib/transport.ts` | bank-local `selectTransport` twin |
| `src/components/WalletLoginButton.tsx` | the button |
| `src/components/WalletLoginDialog.tsx` | the modal |

`selectTransport` is duplicated rather than lifted into `packages/ui` because
that package holds behaviour with no app-specific meaning, and because the
merchant's copy is already tested where it lives. A shared one-line function
across two apps is a coupling with no payoff.

### 6.3 UI

`WalletLoginButton` sits on `/login` beneath the password form, separated by a
divider. It opens `WalletLoginDialog` — a **modal, not a route**. That follows
the payment-sheet lesson: the sheet used to render on its own page where its
scrim dimmed nothing.

The dialog reuses `useDcApiSupport`, `useStatusPoll`, `QrCanvas`, `invokeDcGet`,
`prepareDcApiRequest` and `isDcApiNotSupportedError` from `@demo/ui`, and
`selectTransport` for the transport choice.

- `useDcApiSupport` returning `null` means "not yet known", **not** `false`.
  Rendering the QR on `null` flashes a QR on Android.
- **No `await` may execute** between the click handler starting and
  `navigator.credentials.get()`. Chrome consumes the click's transient
  activation. `dcApiRequest` is therefore a prop before the click, which means
  the session is created when the dialog opens rather than when the wallet
  button is pressed.
- A `dc_api` session can never be re-rendered as a QR — it is bound to
  `response_mode: dc_api.jwt` with an inlined request object and foundry returns
  neither `openid4vp_uri` nor `request_uri`. Recovery is a **new**
  `request_uri` session, which is what "Show QR code" does.
- On a touch device under `request_uri`, follow the deep link rather than
  drawing a QR nobody can scan.

The rendering decision lives in `src/lib/login-dialog-state.ts`, not in JSX.
vitest is `environment: "node"` with `include: ["src/**/*.test.ts"]`, so a
ternary in a `.tsx` file is untested — and branching inside a component is
exactly how a defect in one state stays invisible from the others.

### 6.4 Copy

Catalogued in `src/lib/i18n/messages.ts` under `login`, in both locales:

| Key | en | de |
| --- | --- | --- |
| `login.walletSubmit` | `Login with EUDI-Wallet` | `Mit EUDI-Wallet anmelden` |
| `login.walletDivider` | `or` | `oder` |

plus dialog copy (title, waiting body, scan instruction, failure bodies for
`expired`, `unknown_credential` and `verification_failed`) on the same terms.

`EUDI Wallet` alone is on this repo's hardcoded-proper-noun list, but these are
sentences around it that genuinely differ per locale, so they belong in the
catalog and satisfy `messages.test.ts`'s "no leaf identical across locales"
rule. The catalog is one `Messages` interface, so a key missing from either
locale is a compile error.

`unknown_credential` needs copy that is honest without being alarming: the
credential is valid but this bank cannot tell whose it is, and the remedy is to
add it again from the dashboard.

### 6.5 What is *not* surfaced

A wallet session is byte-identical to a password session. `SessionPayload` stays
`{ userId, displayName }`; no auth-method field is added to the JWT, so no
back-compat rule is needed for cookies signed before this change, and the
dashboard looks the same however you got in.

Decided deliberately: the claim this feature makes is that a wallet is an
**equivalent** authentication factor, and marking it in the UI would undercut
that by presenting it as a special case.

### 6.6 Environment

**No new variables.** `FOUNDRY_ADMIN_URL` and `FOUNDRY_ADMIN_KEY` are already
required by the bank and already used by `getFoundry()`. This deliberately
avoids the documented trap where a new no-default variable must also be added to
the Dockerfile's build-stage `ENV` block, and fails the build remotely from its
cause when it is not.

## 7. Security posture

Stated rather than implied, because the routes in §6.1 are open by necessity.

**The session id is a bearer token.** Whoever holds a `verified` session id can
claim its cookie. Mitigations, all of them in scope:

- `login_${randomUUID()}` — 122 bits of entropy.
- **5-minute TTL**, enforced on every read, not by a scheduled sweep.
- **Single-use**, enforced as a guarded write rather than read-then-write:

  ```sql
  UPDATE login_sessions SET state='consumed' WHERE id=? AND state='verified'
  ```

  and then `.changes === 1` decides whether *this* call won. A read followed by
  a separate write would admit a double-claim.
- Never logged.

**Not implemented, and named rather than implied:**

- No rate limiting on any of the four routes.
- No binding of a login session to the browser that created it. Someone who
  obtains a live session id inside its five-minute window gets the session.

Both are demo-appropriate omissions. Neither should be described as a
limitation discovered later.

## 8. Dependencies and verifiability

### 8.1 External dependency — same-device login is blocked until this ships

`~/dev/dl-infra-k8s/foundry/foundry_config.yml:867` must gain the bank's origin:

```yaml
dc_api_expected_origins: [
  "https://foundry-admin.digitallabor.dev",
  "https://larder-shop.digitallabor.dev",
  "https://sparkasse-musterstadt.digitallabor.dev"   # ← add
]
```

Until it does, a same-device DC API login fails as a **payment-style silent
decline** — the KB-JWT audience will not match, foundry reports a failed check,
and nothing throws in the browser. The QR fallback is what keeps the feature
usable in the meantime, and this is the reason transport (b) was specified with
a fallback rather than as a same-device-only flow.

`dc_api_accept_legacy_web_origin_audience: true` is currently set, which is what
makes real Google Wallet work over the DC API; it is unrelated to this change
but will apply to it.

### 8.2 What can be verified here

- **Unit tests**, in full, for the gate, the state machine, the TTL, the
  single-use guard, and the dialog-state decision.
- **The request leg against the deployed foundry**: a real
  `POST /admin/verification/requests` with
  `named_query_ref: "sparkassen_auth"` returning 200 with a live
  `openid4vp://` URI, and the request object served at that `request_uri`
  naming vct `https://creds.digitallabor.dev/vct/sparkassen_auth`.
- **The browser up to the handover**, with `tools/cdp/cdp.mjs`: the button
  renders, the dialog opens, DC API detection resolves, and the QR draws.

### 8.3 What cannot be verified here

- **A wallet answering.** No device and no EUDI wallet app in this environment.
  No `vp_token` has ever been observed by anything in this repo, so the *shape*
  of the disclosed claims is pinned by foundry's schema and not by observation.
- **Anything end-to-end locally** — see §2.5.
- **Same-device DC API** until §8.1 ships.

Per standing repo policy, no test count is projected. Every projection in this
project's history has been wrong; the number will be measured after the fact.

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| A pre-existing authenticator credential cannot log in | Accepted (§4.3). Needs clear `unknown_credential` copy telling the holder to add it again. |
| Same-device fails silently until §8.1 ships | QR fallback; the operator dependency is stated up front rather than discovered. |
| `sub` claim shape unobserved in a real `vp_token` | The gate fails closed — a missing or non-string `sub` is `verification_failed`, never a login. |
| An open, unauthenticated session-minting endpoint | §7: 122-bit id, 5-minute TTL, guarded single-use write. |
| The `AGENTS.md` "never persisted" claims become false | They must be corrected in the same change, not afterwards. |

## 10. Definition of done

1. `pnpm check` green, with the new total **measured** and recorded.
2. The request leg verified against the deployed foundry, with the actual HTTP
   status and the returned URI quoted in the commit message.
3. The browser leg up to the wallet handover verified with `tools/cdp/cdp.mjs`.
4. Root `AGENTS.md` and `apps/bank/AGENTS.md` updated — including the
   corrections to the "never persisted" / "not correlatable" claims (§4.3) and
   to the 12-hour-lifetime claim (§2.2).
5. §8.1 stated as an open operator dependency wherever this feature's status is
   recorded, and the wallet leg stated plainly as unverified.
