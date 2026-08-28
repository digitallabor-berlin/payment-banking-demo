# PaSO Proof Package — change record

Executed 2026-08-28 from
[`docs/superpowers/plans/2026-08-28-paso-proof-package.md`](../plans/2026-08-28-paso-proof-package.md),
against
[`docs/superpowers/specs/2026-08-28-paso-proof-package-design.md`](../specs/2026-08-28-paso-proof-package-design.md).
Branch `feat/paso-proof-package`, ten commits.

## What landed

The merchant receives foundry's verification-artifact webhook at
`POST /api/verifier-events`, stores each event in a `verifier_events` inbox,
assembles the PaSO Proof/Verify §4.1 package from the two events that carry
artefacts, and forwards it on the existing debit. The bank writes it to
`transaction_proofs` inside `processPayment`'s own SQL transaction, exposes it
at `GET /api/transactions/{id}/proof` scoped to its owner, and shows it from the
ledger behind a seal glyph — decoded by default, with a raw toggle.

## Test count

**847**, measured. Baseline at the start of the plan was **756**, and the plan
refused to project a total.

Both ends reconcile, which is the only reason either number is trustworthy:

| Project | Before | After | Δ |
| --- | --- | --- | --- |
| `apps/merchant` | 212 | 266 | +54 |
| `apps/bank` | 494 | 531 | +37 |
| `packages/ui` | 37 | 37 | 0 |
| `packages/foundry-client` | 13 | 13 | 0 |
| **total** | **756** | **847** | **+91** |

Per-file `it()` deltas, which sum to the same +91:

`apps/merchant` (+54): 18 new in `lib/verifier-events.test.ts`, 9 new in
`lib/proof-package.test.ts`, 7 new in `lib/proof-wait.test.ts`, 7 new in
`app/api/verifier-events/route.test.ts`, 3 new in `lib/bank.test.ts`, +5 in
`lib/settle.test.ts`, +4 in `db/schema.test.ts`, +1 in `env.test.ts`.

`apps/bank` (+37): 18 new in `lib/proof-decode.test.ts`, 4 new in
`app/api/transactions/[id]/proof/route.test.ts`, +9 in `lib/queries.test.ts`,
+4 in `lib/payments.test.ts`, +2 in `db/schema.test.ts`.

Three notes on that arithmetic.

`lib/bank.test.ts` is a **new file the plan did not ask for**, and it is
load-bearing. `settle.test.ts` stubs `BankClient.pay` wholesale, so it asserts
on the camelCase `BankPayInput` and never sees the snake_case body the bank's
zod schema actually parses. Without this file the `proof_package` /
`signed_request` / `vp_token` wire projection — the exact seam this repo lost
`dcApiProtocol` in — would have had no test at all.

`i18n/messages.test.ts` gained **zero** despite both catalogs gaining a whole
`proof` block of eighteen leaves. Its invariants (identical key sets, no empty
leaf, no leaf byte-identical across locales) cover new leaves without new cases,
and a key present in one catalog and missing from the other is a `tsc` error
rather than a test failure. `pnpm typecheck` is the real gate for copy.

Two tests in `settle.test.ts` were **rewritten rather than added**: `seedSession`
now seeds a complete proof package by default, because every settle test that
reaches the bank would otherwise sit in the grace window and never debit. The
fixture was changed, never the assertion — a test that asserted a debit still
asserts a debit.

## The one defect no test found

`lib/proof-decode.ts` originally used `Buffer.from(_, "base64url")`. Its only
consumer is `ProofDialog`, a **client component**, and `Buffer` does not exist in
a browser — so every call raised a `ReferenceError` that landed in the
function's own `try/catch` and became `{ ok: false, reason: "could not decode
base64url" }`. The decoder was a total no-op client-side while all sixteen of
its unit tests passed, because every vitest project here is
`environment: "node"`.

It was found by opening the dialog in real headless Chrome, where both artefacts
read *"Could not be decoded — shown as received."* The fix is `atob` +
`TextDecoder`, both present in Node 18+ and every browser. Two tests now stub
`Buffer` away — one of them for multi-byte UTF-8, which `atob` alone mangles
(`Müller` → `MÃ¼ller`) — and they are the only tests in the suite that could have
caught it. Note they must build their fixtures *before* the stub: the test file's
own `b64u` helper uses `Buffer` too.

This is the plan's own warning arriving exactly where it said it would: *"the one
thing no test covers is the dialog itself."*

## Verified

- `pnpm check` — 847 passing, four projects, typecheck clean.
- `pnpm migrate` applies both new migration sets to real SQLite files. Both
  generated migrations were read before committing: merchant `0005` is a plain
  `CREATE TABLE verifier_events`, merchant `0006` a plain
  `ALTER TABLE payment_sessions ADD verified_at`, bank `0004` a plain
  `CREATE TABLE transaction_proofs` with its foreign key. None needed the
  hand-editing this repo has twice required.
- `pnpm dev` — both apps reach `✓ Ready`, `/api/health` answers 200 on both,
  with the new required env var present.
- Removing `FOUNDRY_WEBHOOK_SECRET` and nothing else fails env validation with
  exactly one named error: `Invalid merchant environment configuration —
  FOUNDRY_WEBHOOK_SECRET: Required`.
- **The webhook, over real HTTP against the running merchant.** A correctly
  signed body answers **204** and writes one `verifier_events` row; the same body
  under a wrong signature answers **401** and writes nothing. That distinction is
  the whole of the endpoint's authentication — a 204 for both would mean the
  check is inert.
- **The viewer, in real headless Chrome** against a hand-seeded package: exactly
  one seal across five ledger rows; the dialog opens decoded with the header and
  payload of both artefacts readable and the disclosure shown as
  `["c2FsdA","psu_id","psu-1"]`; "Show raw" reveals
  `{ "signed_request": …, "vp_token": … }` and toggles back; the German switcher
  translates the whole dialog including `Kopfdaten` and `Nutzdaten`; Copy flips
  to `Kopiert`.

## Deployed, and the part that is now real

**Superseded, same day.** The section below originally said foundry's webhook was
unimplemented and all three of the design's §8 operator dependencies were open.
That was wrong — it was written from the app repo without checking
`dl-infra-k8s`, where the webhook was already configured. Corrected after
deploying:

- `foundry_config.yml` declares `verifier.webhook` pointing at
  `https://larder-shop.digitallabor.dev/api/verifier-events`, with
  `secret_env: FOUNDRY_WEBHOOK_SECRET` and **`include_raw_artifacts: true`**. The
  running pod logs `verification event webhook enabled
  include_raw_artifacts=true`. All three dependencies are **satisfied**.
- The merchant Deployment now carries `FOUNDRY_WEBHOOK_SECRET`, copied from ns
  `foundry` by `make secrets` (`dl-infra-k8s` commit `8b1aa0f`). Without it the
  merchant is a CrashLoopBackOff on rollout, not degraded 500s — `env.ts`
  requires it with no default.
- **Real events are arriving.** Driving sessions through the deployed merchant
  wrote real `verifier_events` rows carrying a **3361-byte** `request_object_jws`
  from foundry, HMAC-verified against foundry's own key. The public endpoint
  answers 204 on a valid signature, 401 on an invalid one.

Three findings from that real data, one of which is a trap worth knowing:

| transport | event at request creation | `signed_request` |
| --- | --- | --- |
| `dc_api_signed` | yes | **3361 bytes** — a package is possible |
| `dc_api` (unsigned) | yes | **null**, twice of two trials — no JWS exists |
| `request_uri` | **none** | fires per `GET /vp/request/:id` *fetch* |

The unsigned DC API form has no JWS to send, and PaSO §4.1 makes both members
required — so **`?dcapi=unsigned` silently disables the proof package**.
`proofPackageFor` returns null, which is correct, but that debugging affordance
is no longer neutral: it is also a "produce no audit artefact" switch.

## Still NOT verified

**No complete package has ever been assembled.** Only the *first* of the two
events has ever been received: every stored `vp_token_json` is null, because no
wallet has completed a presentation against this deployment since the webhook
went live. Consequently:

- `verification_completed` has never been observed at all — its shape, and the
  `skip_serializing_if` absent-key behaviour on `vp_token`, are still read off
  the design rather than measured.
- The decoder has never met a real `vp_token`. Every SD-JWT it has parsed was
  constructed by this repo, and the viewer was verified against a hand-seeded
  package (which is how the `Buffer` no-op was caught).
- `transaction_proofs` in the deployed bank is still empty.

**One real wallet payment over `dc_api_signed` closes all of this.** Until then
every payment takes the full six-second grace period and settles with no
package — the designed degradation, not a failure: `shouldWaitForProof` fails
forward in every branch but one, because an audit artefact is never worth a
payment that does not complete.

One further caveat with teeth, design D6/§9: on the `request_uri` transport
foundry re-signs the request object per fetch and ECDSA is randomized, so several
genuinely different `signed_request` values may exist for one transaction and
nothing records which the wallet consumed. `proofPackageFor` returns the
**newest**, which is the closest available answer and not a correct one. Anyone
implementing PaSO §3's `request_integrity` check against this stored value must
read the design's §9 first.
