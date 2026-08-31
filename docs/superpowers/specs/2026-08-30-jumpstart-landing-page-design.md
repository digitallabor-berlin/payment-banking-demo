# Jumpstart landing page — design

**Date:** 2026-08-30
**Repository:** `git@github.com:digitallabor-berlin/jumpstart.git` (public)
**Status:** approved, ready for an implementation plan

## 1. Purpose

A single public page that lets a person with an Android phone run the
payment-banking demo end to end without asking anyone for help. It explains what
the demo is, what each credential means, and what to click in which order.

The demo it documents lives in the **private** `digitallabor-berlin/payment-banking-demo`
repository and is deployed at:

- Bank (issuer) — <https://sparkasse-musterstadt.digitallabor.dev/>
- Merchant (verifier) — <https://larder-shop.digitallabor.dev/>

**Audience:** someone evaluating EUDI-wallet-as-payment-instrument — a partner, a
colleague, a conference contact. Technical enough to care that the request object
is signed; not necessarily holding the source.

**Success criterion:** a first-time visitor with an Android phone reaches a
completed payment and sees it in the bank's ledger, without a second channel.

## 2. Decisions

Each row records what was chosen and why, so a later reader does not re-litigate
it from scratch.

| Decision | Choice | Why |
| --- | --- | --- |
| Host repository | `digitallabor-berlin/jumpstart` (public) | `payment-banking-demo` stays private. A public repo also makes GitHub Pages free. |
| Branch layout | **Single branch.** `main` holds `docs/`, `README.md` and the site | Requested. A second branch is machinery a one-page site does not earn, and an orphan branch means every later fix has to remember which branch it belongs on. |
| Keeping `docs/` off the web | `_config.yml` `exclude:`, asserted by `check.sh` | The branch split's only real job was keeping the internal spec and plan out of the public web root. `exclude:` does the same thing, but silently — so the check asserts `_site/docs` does not exist rather than trusting the key stays put. |
| Pages source | Deploy from branch, `main` → `/` | Follows from the single branch. |
| Build | GitHub Pages' native Jekyll build | No workflow file, no Gemfile, no plugins. Only possible because no theme gem and no plugins are used. |
| Theme | **None.** Stock Jekyll, one hand-written layout and one stylesheet | `minima` is a blog theme; the page needs a hero, a step rail and a credential grid. "Default Jekyll" is honoured as the *tooling*, not as the *look*. |
| Page structure | One scrolling page with a sticky section nav | A person follows this with a phone in one hand. One URL, no navigation mid-flow. |
| Legal notice | A **second page** at `/imprint/`, linked from the footer of every page | *Added 2026-08-31.* Six hundred words of statutory text at the foot of a walkthrough would bury the last step and lengthen the scroll for every reader, to serve a need none of them arrived with. A footer link on every page also satisfies the "easily recognisable, directly reachable, permanently available" expectation better than a section someone has to scroll past the whole demo to find. This does not reopen the multi-page question below: the *walkthrough* is still one page, and no walkthrough content moved. |
| Domain | None — `https://digitallabor-berlin.github.io/jumpstart/` | Requested. Forces `baseurl: "/jumpstart"`; see §6. |
| Content storage | Repeating copy in `_data/*.yml`, rendered through includes | A wording fix is a YAML edit, and no credential card can drift out of shape from the others. |
| Artwork | Reuse the real assets from the bank app | Approved. The page looks like the demo it documents. |
| Demo login | Printed on the page, behind a demo-environment callout | Approved, knowing the repo and the site are both public. |
| Fonts | Fira Sans + Fira Mono, **self-hosted** | The bank's typeface, tying the page to the demo without borrowing its red. Self-hosted so the page makes no Google Fonts CDN call. |

### Rejected alternatives

- **`minima` with overrides** — you fight the gem's opinions on every custom
  section and the result is neither clean minima nor a coherent design.
- **Multi-page site** — a first-time visitor would have to click four times to
  learn whether the demo is worth their time. (This concerns *walkthrough*
  content. The legal notice added on 2026-08-31 is a second page precisely
  because it is not walkthrough content; see the decision table above.)
- **A separate `gh-pages` branch** (orphan, or built by Actions) — two branches
  to keep straight, and every later edit starts by asking which one it lands on.
  The single thing it protected is covered by `exclude:` plus an assertion.
- **Full-dark page** — a six-step walkthrough is measurably harder to follow in
  light-on-dark, and the real card faces were composed against a light ground.

## 3. Information architecture

One page, top to bottom. A sticky nav links four anchors — *What this is*,
*Walkthrough*, *Credentials*, *Built on*. The hero, the demo-environment band and
the transports section are reached by scrolling, not by the nav; a nav with eight
entries stops being navigation.

The **legal notice at `/imprint/`** is the only other page. It is reached from a
footer link and never from the section nav, which is in-page anchors and would be
four dead links anywhere but the walkthrough — the layout therefore renders that
nav only when a page sets `section_nav: true`, and shows a *Back to the
walkthrough* link otherwise. `check.sh` asserts both halves of that: the legal
notice must not carry the section nav, and every built page must link the legal
notice.

1. **Hero** — title, one-sentence summary, a "reference implementation of PaSO"
   badge, two CTAs: *Download the wallet* and *Open the bank*.
2. **What this is** — four sentences: wallet-as-payment-instrument; a reference
   implementation of the PaSO specs; `foundry` as issuer/verifier; the two apps.
3. **Demo environment** — a visually distinct band, not a footnote. Fake data, no
   real money, and the login.
4. **Two ways the wallet is reached** — placed *before* the walkthrough so both
   the issuance step and the payment step point at it instead of repeating it.
5. **Walkthrough** — six numbered steps on a vertical rail (§4.3).
6. **Credential reference** — a four-card grid *after* the walkthrough, so step 3
   stays short (§4.1).
7. **Built on** — PaSO, foundry, EMVCo DPC, the elpaso wallet.
8. **Footer** — Digitallabor Berlin. No repository link; the source repo is
   private and the link would 404 for most visitors.

## 4. Content specification

Every claim below is drawn from the demo's source and `AGENTS.md`. Where the page
cannot verify something, it says less rather than more — §4.5.

### 4.1 The four credentials

| Credential | Attests | Formats | Wallets offered | Used for | Bank section |
| --- | --- | --- | --- | --- | --- |
| **Sparkassen-Card** (girocard) | A payment card on the account | **two** — `com.emvco.dpc.card` and `sparkassencard` | EUDI Wallet **and** Google Wallet | Paying at Larder | Payments |
| **Wero** | A payment instrument on the account | one — `wero` | EUDI Wallet only | Paying at Larder | Payments |
| **Age verification** | `age_over_16` and `age_over_18`, nothing else | **two** — `av-sparkasse` and `av` | EUDI Wallet **and** Google Wallet | Buying beer, wine or aperitif | Credentials |
| **Sparkassen Authenticator** | That the holder is an authenticated customer — one claim, `sub` | one — `sparkassen_auth` | EUDI Wallet only | Logging in without a password | Credentials |

Two facts the cards state because they are the interesting part:

- The girocard's two formats **share no claims** —
  `{credential_id, network, card_id}` versus `{sub, masked_iban, psu_id}`. Not a
  superset, not a rename.
- The age credential's two formats are **byte-identical in their claims** and
  differ only in wrapper. One attestation, two wallets.

The bank dashboard's own headings are **Payments** and **Credentials**; the
walkthrough uses those words so the reader can find the tiles.

### 4.2 The Google Wallet caveat

Stated precisely, and **per credential rather than globally**:

> The "Add to Google Wallet" badge appears on the **Sparkassen-Card and the age
> credential only**, and requires a **non-public beta build of Google Wallet**.
> Wero and the Sparkassen Authenticator offer a single EUDI Wallet button.

A blanket "Google Wallet needs a beta" would imply all four credentials offer it.

### 4.3 The six walkthrough steps

1. **Install the wallet** — the elpaso APK
   (<https://github.com/digitallabor-berlin/elpaso/releases/download/latest/elpaso-release.apk>).
   Android.
2. **Log in to the bank** — <https://sparkasse-musterstadt.digitallabor.dev/>,
   `anna` / `demo1234`.
3. **Issue your credentials** — the four tiles under *Payments* and
   *Credentials*, plus the Google Wallet caveat. Points back at §4.4 for the two
   transports.
4. **Log in with the Sparkassen Authenticator** — password-free login. One
   sentence on the binding (§4.5).
5. **Pay at Larder** — <https://larder-shop.digitallabor.dev/>. Basket, checkout,
   amount binding. Adding a **Beer** (or Wine, or Aperitif) also triggers the age
   check; the rest of the shelf does not.
6. **See the result** — the debit appears under *Recent transactions* in the bank,
   carrying a stored PaSO proof package.

### 4.4 Transports

Both are available in **both** directions, and the page says so explicitly:

- **Issuance** — a QR code / `openid-credential-offer://` deep link
  (cross-device), or the **Digital Credentials API** via
  `navigator.credentials.create()` (same-device).
- **Verification** — a QR code / `openid4vp://` deep link, or the **Digital
  Credentials API** via `navigator.credentials.get()`.

The request object is **signed by default**.

A one-line browser note: the DC API path needs Chrome on Android. On Safari the
wallet button reports that issuance is not supported and a QR code appears
instead.

### 4.4a Naming the wallet

*Added 2026-08-31 at the client's request.* The page does **not** call it an
EUDI wallet, and does not say European Digital Identity. The demo works with any
wallet that speaks **OpenID4VC**; naming the EU scheme implies a conformance and
a scope the demo does not have. The per-credential wallet line reads "Any
OpenID4VC wallet", plus "and Google Wallet" on the two that offer the badge.
`check.sh` check 12 asserts the words do not reappear.

### 4.4b The payment schemes are worked examples

*Added 2026-08-31 at the client's request.* Wero and the Sparkassen-Card are
real products belonging to other people. The credential section carries a
standing disclaimer that they appear here as modelled examples of a card scheme
and an account-to-account scheme, and that the page says nothing about what the
real products do, support or intend to support. `check.sh` check 18 asserts it
is present — a claim about someone else's product does not get to go missing in
a reflow.

### 4.5 Claims the page makes carefully

These are the places where an overstatement would misrepresent the system.

> **Verified against the demo source on 2026-08-30.** A review flagged three of
> these as possibly unsupported; all three were checked in
> `payment-banking-demo` and found correct. The citations are recorded here so
> the next reader does not re-open them, and does not "fix" accurate copy into
> vagueness:
>
> - **Wero reuses the girocard's non-DPC claim set.** `apps/bank/src/lib/credential-types.ts`
>   — "Payable like the two girocard formats, and it reuses their non-DPC claim
>   set (`{ sub, masked_iban, psu_id }`), but it is NOT a format of the
>   girocard." The page may state the shared claims; it must keep saying Wero is
>   a separate instrument.
> - **The login binding prevents replay.** `apps/bank/src/lib/login-sessions.ts`
>   — "That is what makes a captured `vp_token` non-replayable: without it, a
>   verified presentation is a bearer credential for this bank's session cookie
>   for as long as the credential lives."
> - **The amount is bound to the approval, and the merchant enforces it.**
>   `apps/merchant/src/lib/checks.ts` — `passedTransactionDataBinding` gates
>   settlement; "a resolved credential whose binding check did not pass fails
>   the gate outright."
>
> One constraint found during that check and not previously recorded here:
> `apps/bank/src/db/schema.ts` states that the bank runs "no signature
> verification, no `request_integrity`, no `jti` replay cache — **and no UI copy
> may imply otherwise**." Step 4's replay sentence is about the *login* binding,
> which foundry does check, and is therefore not in conflict. Any future copy
> about the *payment* proof package must not acquire a replay-protection claim.

- **Login binding.** The Authenticator presentation is bound to a
  `transaction_data` entry carrying a login timestamp, and the bank **requires
  that binding back**. A wallet that ignores `transaction_data` cannot log in.
  This is the security point of the login flow and gets one sentence.
- **Who configures the consent dialog.** *Added 2026-08-31 at the client's
  request.* Step 4 states that what the wallet shows is the bank's wording: the
  bank sends a **typed PaSO `transaction_data` entry** and the type is what tells
  the wallet which shape of approval it is rendering. Grounded in
  `apps/bank/src/lib/login-transaction-data.ts`, whose type is literally
  `urn:paso:sca:dev.digitallabor:login:1` and whose comment says the version
  exists because "a wallet that renders the payload for human confirmation needs
  to know which shape it is looking at". **The client described this as the PaSO
  *issuer metadata* specification; that term appears nowhere in the demo source,
  so the page describes the mechanism it can demonstrate rather than naming a
  spec section that could not be verified from this repository.** If issuer
  metadata is in fact the governing mechanism, the wording should be corrected.
- **What the Authenticator authorises.** *Revised 2026-08-31.* The credential
  section lede says it "authorises transactions with your bank that require
  strong customer authentication". The card body previously said "it authorises
  no money", which then read as a flat contradiction; it now says it
  **authenticates rather than pays** — the bank still refuses a debit against it,
  which is the source-grounded fact
  (`credential-types.ts`: not payable, must never reach `processPayment`), and
  the money is still authorised by a payment credential.
- **The proof package is stored, not verified — and the page no longer says so.**
  The bank keeps the signed request object and the `vp_token` and **checks
  nothing in them**. *Revised twice on 2026-08-31 at the client's request:* first
  the walkthrough's closing line went, then the `Built on` note. Both read as an
  apology for a missing feature rather than a statement of scope.

  What that changes is what can be enforced. The obligation in
  `apps/bank/src/db/schema.ts` is **"no UI copy may imply otherwise"** — it
  forbids claiming verification, it does not require disclosing its absence. So
  `check.sh` check 8 was inverted rather than deleted: it now fails if any page
  claims the proof package is verified or validated, and is deliberately narrow
  enough not to trip on "issuer and verifier" or "issuance and verification",
  both of which are correct elsewhere on the page. **Silence is permitted; a
  claim is not.** The residual exposure is recorded in §9.
- **The DPC is referenced, and never attributed to the card.** *Revised
  2026-08-30 at the client's request — stricter than the original decision.*
  The page mentions the EMVCo Digital Payment Credential **only as a draft
  proposal, in the *Built on* section**, and does **not** connect it to the
  Sparkassen-Card anywhere. The earlier wording — "the first format models an
  EMVCo DPC" — was accurate but still invited a reader to infer a conformance
  relationship between the card and the proposal, which is the exact inference
  this section exists to prevent. The card now names its own format ids
  (`com.emvco.dpc.card`, `sparkassencard`) and says nothing about EMVCo.
  The page links only the evergreen explainer
  (<https://www.emvco.com/knowledge-hub/defining-an-emv-digital-payment-credential/>),
  exactly once, and never the versioned draft, whose comment period has closed
  and whose URL will rot. `check.sh` asserts the link count is exactly one.
- **Lifetime and revocation.** `sparkassen_auth` and `sparkassencard` are issued
  for **365 days**, and there is **no revocation** anywhere in the demo.
- **Pre-login Authenticator credentials.** An Authenticator credential issued
  before wallet login existed cannot log in; there is no backfill.

### 4.6 External references

| Target | URL | Placement |
| --- | --- | --- |
| Wallet APK | `https://github.com/digitallabor-berlin/elpaso/releases/download/latest/elpaso-release.apk` | Hero CTA, step 1 |
| Bank | `https://sparkasse-musterstadt.digitallabor.dev/` | Hero CTA, step 2 |
| Merchant | `https://larder-shop.digitallabor.dev/` | Step 5 |
| PaSO specs | `https://aptitude-consortium.github.io/payments-and-sca-for-openid/latest` | Hero badge, Built on |
| foundry | `https://github.com/digitallabor-berlin/foundry` | Built on |
| EMVCo DPC explainer | `https://www.emvco.com/knowledge-hub/defining-an-emv-digital-payment-credential/` | Built on **only** — never the girocard card; see §4.5 |
| elpaso wallet | `https://github.com/digitallabor-berlin/elpaso` | Built on |

## 5. Visual design

**Governing constraint:** this page is a *third* brand — not the bank, not the
shop. It hosts Sparkasse-red card artwork, Wero's yellow and Google's badge. If
the chrome is itself saturated, the credential cards — the only things that
should be loud — disappear into it. Therefore: **neutral chrome, colour only in
the artwork.**

- **Structure:** a deep ink-navy hero band carrying the title, badge and CTAs;
  everything below on a cool near-white ground. The walkthrough runs down a
  vertical numbered rail. The credential cards sit on light, where the real card
  faces were composed to sit.
- **The credentials are a list, not a grid.** *Revised 2026-08-31 at the
  client's request.* Four cards in auto-fit columns forced every card to the
  height of the wordiest one and left three ragged gaps under the shorter ones,
  and the reading order across-then-down fought the Payments / Credentials
  grouping. They now stack, each card a row with the face in a fixed 272px left
  column, so the four artworks form a column of their own and each card is only
  as tall as its own content. Below 720px the card stacks and the face goes full
  width, which is how the bank's own tiles look.
- **Step screenshots.** *Added 2026-08-31.* Steps 2–5 carry captures of the real
  flow, declared as a `shots` list in `_data/steps.yml` so a caption is a YAML
  edit like every other piece of copy. Frames are deliberately quiet — hairline
  border, small radius, no shadow and no fake device bezel — because the
  credential artwork must stay the loudest thing on the page and eleven
  shadowed phone mockups would take that away from it. The aspect ratio is
  declared per `kind` so the browser reserves the box before a lazy image
  arrives; without it the rail below jumps as each one loads.
- **The `Built on` marks.** *Added 2026-08-31.* foundry and elpaso ship a logo.
  PaSO and EMVCo do not, so rather than leave two ragged empty slots they get a
  typographic mark. This was originally justified by the Sparkassen Authenticator
  card, which drew its name as type for want of a picture; that card has real
  artwork now, so these two marks are the only place left on the page where type
  stands in for an image.
- **Accent:** the EudiPay/PaSO blue family (`#004dd7`) for links, the step rail
  and the primary CTA. Chosen because it belongs to the *spec* rather than to
  either app, so it cannot imply the page is the bank's or the shop's.
- **Type:** Fira Sans for text, Fira Mono for URLs, credential type ids
  (`com.emvco.dpc.card`, `sparkassen_auth`) and the demo login. Self-hosted
  `woff2`, **four faces only** — Fira Sans 400/600/700 and Fira Mono 400. Both
  are SIL Open Font License 1.1; the licence text ships in `assets/fonts/OFL.txt`
  and the footer carries the attribution.
- **Credential card faces.** *Revised 2026-08-31: the client supplied purpose-
  drawn artwork and the borrowed assets were deleted.* The four faces are
  `credentials/{sparkassencard,wero,av,authenticator}.webp`, each a complete
  opaque card. They replace `card-face.webp`, `wero-logo.svg` and `av-face.svg`,
  which were reused from the bank app — two of those were a bare logo on a flat
  brand ground rather than a card, and the Authenticator had no artwork at all.
  Because every credential now carries a finished face, the CSS no longer sets a
  brand-colour ground behind it, there is no per-credential modifier class, and
  the `face` key is gone from `_data/credentials.yml`. The masters run 1.485 to
  1.511, so the box is declared at a flat 3/2 and the image is `contain`-fitted:
  at most a couple of pixels of letterbox, and nothing of the artwork is cropped.
- **`add-to-google-wallet.svg`** is still reused from the bank app, and is sized
  by height only — its brand guidelines forbid altering proportions or colours.
- **Image pipeline.** Masters live in `_src/img/` and are **never served**: as
  supplied they are 6.2 MB of 2048px logos and full-resolution captures, which
  on a page meant to be followed on a phone at a conference is a defect rather
  than a detail. `_src/optimize.sh` resizes each to twice its largest displayed
  size and writes a `webp` into `assets/img/`; the served set is 392 KB.
  `check.sh` asserts no served asset exceeds 150 KB and that no png or jpeg
  appears under `assets/img` at all — a master copied to the wrong directory
  builds green and looks identical on a laptop, so the format is the tell.
- **Responsive:** the walkthrough is read on a laptop beside a phone, so the
  single-column mobile layout must not lose the step numbers.

## 6. File layout and Jekyll mechanics

On `main`, alongside the existing `docs/` and `README.md`:

```text
check.sh                   build-and-verify harness; excluded from output
_config.yml
index.html                 Liquid, not Markdown — the page is composed sections
_data/steps.yml            the six walkthrough steps, as copy
_data/credentials.yml      the four credential cards, as copy
_includes/step.html
_includes/credential-card.html
_layouts/default.html
assets/css/style.css
assets/fonts/*.woff2        four faces + OFL.txt (§5)
assets/img/                add-to-google-wallet.svg, foundry-logo.webp,
                           elpaso-logo.webp
assets/img/credentials/    the four card faces (§5)
imprint.html               the legal notice; permalink /imprint/ (§2, §3)
assets/img/screenshots/    eleven webp captures used by the walkthrough
_src/img/                  the image MASTERS. Never served — see §5.
_src/optimize.sh           regenerates assets/img from _src/img
```

**`docs/`, `README.md` and `check.sh` are excluded** in `_config.yml`, so the
published site is only the page and its assets. §9 records why this is asserted
rather than trusted.

**`baseurl` is the one real trap.** The site lives at
`https://digitallabor-berlin.github.io/jumpstart/`, so `_config.yml` sets
`baseurl: "/jumpstart"` and `url: "https://digitallabor-berlin.github.io"`.
**Every** internal link and asset reference must go through `relative_url`. A
missed one 404s in production and never locally, which is exactly the failure
mode that is hardest to catch.

Long prose inside the YAML data files is Markdown, rendered through
`markdownify`.

**Local Jekyll is not production Jekyll.** GitHub Pages builds with the
`github-pages` gem, pinned to **Jekyll 3.10**; the machine this was designed on
has **4.4.1**. No `Gemfile` is committed — installing `github-pages` on Ruby 3.4
is its own fight, and the build genuinely needs nothing. The mitigation is a
constraint rather than a tool: **use only Liquid and Jekyll features present in
both 3.10 and 4.x** — `_data`, `_includes`, `relative_url`, `markdownify`,
`where`, `default`. Nothing newer. Stylesheets are plain CSS with no front
matter, referencing fonts by a path relative to the stylesheet
(`../fonts/…`), which resolves correctly under any `baseurl` without Liquid
touching it at all.

## 7. Publishing and operator dependencies

1. Commit the site to `main` in `digitallabor-berlin/jumpstart` and push.
2. **Operator step — cannot be done from the working copy:** enable GitHub Pages
   on the repository, source = *Deploy from a branch*, branch = `main`,
   folder = `/`. The repository currently has **no Pages site configured**
   (`GET /repos/.../pages` → 404).
3. Verify the published URL serves the page and that no asset 404s — the
   `baseurl` class of bug only appears here.

## 8. Non-goals

- No analytics, no cookies, no consent banner. Nothing on the page phones home,
  which is also why the fonts are self-hosted.
- No German translation. The bank app is bilingual; this page is English-only.
- No documentation of the demo's internals, architecture or source layout. The
  page is a walkthrough, not a developer guide.
- No CI. The page is built by GitHub Pages itself.
- The `?dcapi=unsigned` debugging flag is **not** documented. It silently
  disables the PaSO proof package, and a public page should not offer a switch
  whose name does not say what it turns off.

## 9. Known risks

- **The page no longer discloses that the stored proof package is unverified.**
  *Accepted by the client on 2026-08-31; recorded here because it is a genuine
  exposure rather than a tidy-up.* The page describes itself as a reference
  implementation of the PaSO specifications and shows a proof package being
  stored against a payment. A technical reader may reasonably infer that the
  package is also checked — it is not, and nothing on the page now says so.
  Mitigated only in the negative: check 8 fails if any copy ever claims
  verification. If the page is later used to make a conformance argument, this
  is the sentence whose absence will matter.
- ~~**The legal notice contradicts the page's own stated audience.**~~ *Resolved
  2026-08-31:* the "Target audience of the website" clause — the site being
  "exclusively directed at persons resident in the Federal Republic of Germany"
  — was removed from the imprint at the client's request. It was DSGV
  boilerplate from a banking site and did not describe this one.
- **The footer names a different organisation from the imprint.** The footer
  says *Digitallabor Berlin*; the legal notice names **Deutscher Sparkassen- und
  Giroverband e.V.** as publisher. If Digitallabor Berlin is not the publisher in
  the statutory sense this is correct as it stands, but the two names sitting a
  few centimetres apart invites the question and nobody has answered it in
  writing.
- **The screenshot captions are unverified against the images.** The captions in
  `_data/steps.yml` were written from the master **filenames** and the step they
  illustrate, because no model in the session that added them could see an
  image. They are therefore accurate about *which* capture is shown and
  unverified about what is *in* the frame. A human must read the eleven captions
  against the eleven pictures once; nothing automated can close this.
- **`docs/` reaching the public web root.** The site and the internal spec now
  share a branch, so only `_config.yml`'s `exclude:` keeps the spec and plan
  unpublished. A key deleted during an unrelated edit would publish them with no
  visible symptom. Mitigated by `check.sh` asserting `_site/docs` does not exist.
- **`baseurl` link rot** — see §6. Mitigated by an actual check: the build
  script greps the generated `_site/index.html` for any root-relative `href`/`src`
  that did not go through `relative_url`, and asserts every internal reference
  resolves to a file that exists. This is the one production-only failure mode
  that can be caught locally.
- **Local Jekyll 4.4.1 versus production Jekyll 3.10** — see §6. A feature
  present only in 4.x would build clean locally and fail on GitHub Pages. Not
  caught by any local check; mitigated only by the feature constraint and by the
  §7.3 verification against the published URL.
- **The APK "latest" URL** is a moving target. If the release tag scheme changes,
  the hero CTA breaks silently.
- **The artwork is copied, not referenced.** If the bank app's card face changes,
  this page will not follow. Accepted: the alternative is a cross-repo build.
- **The demo login is public.** Accepted knowingly; the bank is a public
  deployment holding fixture data and no real money.
- **Both deployments must be up** for the page to be useful. The page has no
  status indicator and cannot detect an outage.
