# Jumpstart Landing Page Implementation Plan

**Status: complete and published, 2026-08-30.** All six tasks executed on
`main`. Live at <https://digitallabor-berlin.github.io/jumpstart/>; the first
GitHub Pages build reported `built` with no error, which also closes the
Jekyll 3.10-versus-4.4.1 risk in §9 of the spec — production built the site as
written. Verified against the published URL: page 200, all ten assets 200, zero
root-relative references, and `docs/`, `README.md`, `check.sh` and `_config.yml`
all 404. `check.sh` runs eleven assertions and is green.

**Changes after publication, on request:** the EMVCo DPC reference was detached
from the Sparkassen-Card (2026-08-30); the credential grid became a list, the
walkthrough gained eleven screenshots, and `Built on` gained the foundry and
elpaso logos (2026-08-31); the borrowed credential artwork was replaced with
client-drawn card faces, which removed the `face` key, the four brand-colour
grounds and the Authenticator's typographic fallback (2026-08-31). See §5 and §9
of the spec — including the one risk
that only a human can close, that the screenshot captions were written from
filenames because no model in the session could see an image.

Deviations from this plan, each recorded in the commit that made it: the branch
layout became single-branch on request, and `check.sh` gained the `_site/docs`
assertion that replaces what the branch split was buying; `formats` is unwrapped
with `remove: '<p>'` rather than `strip_html`, which would have stripped the
`code` element the spec wants set in Fira Mono; Task 6's browser script scrolls
before judging images broken, because the lazy-loaded card art below the fold
otherwise reports false failures; and a `prefers-reduced-motion` block plus a
44px nav tap-target fix were added that the plan did not specify.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a single Jekyll page at `https://digitallabor-berlin.github.io/jumpstart/` that walks a first-time visitor through the payment-banking demo end to end.

**Architecture:** Stock Jekyll with no theme gem and no plugins, built by GitHub Pages' own native build. One hand-written layout, one plain-CSS stylesheet, two `_data` YAML files holding the repeating copy, two includes rendering it. Everything lives on `main` — site, docs and README together — and `_config.yml`'s `exclude:` keeps `docs/` out of the published output.

**Tech Stack:** Jekyll (Liquid, `_data`, `_includes`, `relative_url`, `markdownify`), plain CSS, self-hosted Fira woff2. No Ruby dependencies to install, no Node, no build step beyond `jekyll build`.

**Spec:** `docs/superpowers/specs/2026-08-30-jumpstart-landing-page-design.md` (on `main`)

## Global Constraints

Every task's requirements implicitly include this section.

- **Repository:** `git@github.com:digitallabor-berlin/jumpstart.git`, working copy at `/Users/senexi/dev/eudiw/jumpstart`. Public.
- **Single branch.** ALL work happens on `main`, alongside the existing `docs/` and `README.md`. There is no `gh-pages` branch and none is to be created.
- **`docs/` must never be published.** `_config.yml` `exclude:` lists `docs`, `README.md` and `check.sh`. This is the *only* thing keeping the internal spec and plan off the public web root, so `check.sh` asserts `_site/docs` does not exist rather than trusting the key.
- **`baseurl` is `/jumpstart`.** Every internal `href` and `src` in HTML MUST go through `relative_url`. A root-relative URL works locally and 404s in production. `check.sh` enforces this — see Task 1.
- **Stylesheet URLs are the exception:** `assets/css/style.css` is plain CSS with **no front matter**, so Liquid never runs in it. It references fonts as `../fonts/…`, which resolves relative to the stylesheet under any `baseurl`. Do NOT add front matter to it and do NOT use `relative_url` inside it.
- **Jekyll feature floor:** GitHub Pages builds with **Jekyll 3.10**; this machine has **4.4.1**. Use ONLY features present in both: `_data`, `_includes`, `relative_url`, `markdownify`, `default`, `where`. No `{% link %}`, no Jekyll 4 Sass, no `jekyll-*` plugins, no `Gemfile`.
- **No theme gem.** `_config.yml` must not contain a `theme:` or `remote_theme:` key.
- **Language:** English only. No German translation, no locale switching.
- **Privacy:** no analytics, no cookies, no third-party requests at runtime. Fonts are self-hosted for exactly this reason.
- **Fonts:** Fira Sans 400/600/700 and Fira Mono 400 ONLY — four `woff2` files. SIL OFL 1.1; `assets/fonts/OFL.txt` ships alongside and the footer carries attribution.
- **Artwork source.** *Superseded 2026-08-31 — the task bodies below still describe the original arrangement and are kept as a record of what was built.* Only `add-to-google-wallet.svg` is still reused from `/Users/senexi/dev/eudiw/payment-banking-demo/apps/bank/public/`. The credential faces are now client-supplied artwork under `_src/img/credentials/`, rendered to `assets/img/credentials/*.webp`; `card-face.webp`, `wero-logo.svg` and `av-face.svg` were deleted. **All images follow the pipeline:** masters in `_src/img/`, `_src/optimize.sh` generates the served `webp`, and nothing outside `_src` is ever a png or jpeg. Copy assets in; do not link across repositories.
- **The Google Wallet badge is sized by height only** (`height` set, `width: auto`). Its brand guidelines forbid altering proportions or colours.

### Copy rules — these are correctness, not style

- The EMVCo DPC is mentioned **only in "Built on", only as a draft proposal, and is never attributed to the Sparkassen-Card.** (Revised at the client's request; the original rule allowed "the girocard *models* a DPC", which was accurate but still invited a conformance inference.) NEVER "conforms to", "implements" or "is compliant with" either. Link `https://www.emvco.com/knowledge-hub/defining-an-emv-digital-payment-credential/` **exactly once** — `check.sh` check 13 asserts the count — and never the versioned draft.
- The proof package is **stored and not verified**. The bank checks nothing in it. No copy may imply verification, and no checkmark glyph may be used for it.
- The Google Wallet caveat is **per credential**: the badge exists on the Sparkassen-Card and the age credential ONLY, and needs a **non-public beta build** of Google Wallet. Wero and the Sparkassen Authenticator have a single EUDI Wallet button.
- Both transports work in **both** directions — issuance and verification.
- Do **not** document `?dcapi=unsigned`. It silently disables the proof package.

### Exact URLs — copy verbatim

| Name | URL |
| --- | --- |
| Wallet APK | `https://github.com/digitallabor-berlin/elpaso/releases/download/latest/elpaso-release.apk` |
| elpaso repo | `https://github.com/digitallabor-berlin/elpaso` |
| Bank | `https://sparkasse-musterstadt.digitallabor.dev/` |
| Merchant | `https://larder-shop.digitallabor.dev/` |
| PaSO specs | `https://aptitude-consortium.github.io/payments-and-sca-for-openid/latest` |
| foundry | `https://github.com/digitallabor-berlin/foundry` |
| EMVCo DPC explainer | `https://www.emvco.com/knowledge-hub/defining-an-emv-digital-payment-credential/` |

---

## File Structure

All paths are relative to the repository root on `main`, alongside the existing `docs/` and `README.md`.

| File | Responsibility |
| --- | --- |
| `check.sh` | The build-and-verify harness. Excluded from the published output. |
| `_config.yml` | Site metadata, `baseurl`, `exclude`. No theme, no plugins. |
| `_layouts/default.html` | The single layout: `head`, sticky nav, `{{ content }}`, footer. |
| `_includes/step.html` | Renders one walkthrough step from a `_data/steps.yml` entry. |
| `_includes/credential-card.html` | Renders one credential card from a `_data/credentials.yml` entry. |
| `_data/steps.yml` | The six walkthrough steps. Copy lives here, not in markup. |
| `_data/credentials.yml` | The four credentials. Copy lives here, not in markup. |
| `index.html` | Composes the eight sections. The only page. |
| `assets/css/style.css` | The entire stylesheet. Plain CSS, no front matter. |
| `assets/fonts/*.woff2` | Four faces plus `OFL.txt`. |
| `assets/img/*` | Four artwork files copied from the bank app. |

Each task below ends with a green `./check.sh` and a commit.

---

### Task 1: Orphan branch, config, and the check that guards `baseurl`

The deliverable is a site that builds plus the harness every later task depends on. The check is written FIRST and must fail before anything exists.

**Files:**

- Create: `check.sh`
- Create: `_config.yml`
- Create: `_layouts/default.html`
- Create: `index.html`
- Create: `assets/css/style.css`

**Interfaces:**

- Consumes: nothing.
- Produces: `./check.sh`, exit 0 on success. Every later task runs it. `_config.yml` key `baseurl: "/jumpstart"`. Layout name `default`.

- [ ] **Step 1: Confirm the starting point**

```bash
cd /Users/senexi/dev/eudiw/jumpstart
git branch --show-current
git status --short
ls
```

Expected: branch `main`, `docs/` and `README.md` present, no site files yet. Nothing is created or deleted in this step — the single-branch layout means there is no branch surgery to do.

- [ ] **Step 2: Write the failing check**

Create `check.sh`:

```bash
#!/usr/bin/env bash
#
# Build the site and assert the things that only break in production.
#
# The one failure mode this exists for: an internal href or src that skipped
# `relative_url` resolves fine on a local server rooted at / and 404s under
# GitHub Pages' /jumpstart/ prefix. Nothing about the local render reveals it.
# See the design doc section 6.
set -euo pipefail

BASEURL="/jumpstart"

fail() { echo "FAIL: $*" >&2; exit 1; }

rm -rf _site
jekyll build --quiet || fail "jekyll build exited non-zero"

[ -f _site/index.html ] || fail "_site/index.html was not built"

# 1. No root-relative reference may bypass the baseurl prefix.
if grep -ohE '(href|src)="/[^"]*"' _site/index.html | grep -v "\"${BASEURL}/"; then
  fail "the references above are root-relative and skipped relative_url"
fi

# 2. Every internal reference must resolve to a file that exists.
missing=0
while IFS= read -r ref; do
  path="${ref#"$BASEURL"}"
  path="${path%%#*}"
  path="${path%%\?*}"
  [ -n "$path" ] || continue
  [ "$path" = "/" ] && path="/index.html"
  if [ ! -e "_site${path}" ]; then
    echo "missing: ${ref}" >&2
    missing=1
  fi
done < <(grep -ohE '(href|src)="'"${BASEURL}"'[^"]*"' _site/index.html \
           | sed -E 's/^(href|src)="//; s/"$//' | sort -u)
[ "$missing" -eq 0 ] || fail "internal references point at files that do not exist"

# 3. The internal spec and plan must not be published. On a single branch this
#    is guaranteed only by `exclude:` in _config.yml — assert the outcome.
[ ! -e _site/docs ] || fail "_site/docs exists — docs/ is being published; check exclude: in _config.yml"
[ ! -e _site/README.md ] || fail "_site/README.md exists — check exclude: in _config.yml"

echo "OK: $(find _site -type f | wc -l | tr -d ' ') files built, all internal references resolve"
```

```bash
chmod +x check.sh
```

- [ ] **Step 3: Run it to confirm it fails for the right reason**

Run: `./check.sh`
Expected: `FAIL: _site/index.html was not built`

If it instead fails on `jekyll build exited non-zero`, that is also acceptable at this point — but read the message. A failure for any *other* reason means the script is wrong, not the site.

- [ ] **Step 4: Write the minimal site**

Create `_config.yml`:

```yaml
title: Jumpstart
description: >-
  Run the payment-banking demo end to end: install the wallet, issue the
  credentials, log in without a password, and pay at the shop.

url: "https://digitallabor-berlin.github.io"
baseurl: "/jumpstart"
lang: en

# No `theme:` and no `plugins:` on purpose. GitHub Pages' native build serves
# this site as-is; adding either would break that and require a Gemfile.

# docs/ holds the internal spec and plan and must not reach the public web
# root. This key is the only thing preventing that; check.sh asserts the
# result rather than trusting the key.
exclude:
  - check.sh
  - docs
  - README.md
  - .agents
  - skills-lock.json
```

Create `_layouts/default.html`:

```html
<!DOCTYPE html>
<html lang="{{ site.lang | default: 'en' }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ page.title | default: site.title }}</title>
    <meta name="description" content="{{ page.description | default: site.description }}">
    <link rel="stylesheet" href="{{ '/assets/css/style.css' | relative_url }}">
  </head>
  <body>
    {{ content }}
  </body>
</html>
```

Create `index.html`:

```html
---
layout: default
title: "Jumpstart — the EUDI wallet as a payment instrument"
---
<main>
  <h1>Jumpstart</h1>
</main>
```

Create `assets/css/style.css`:

```css
/*
 * The whole stylesheet. Plain CSS with NO front matter, so Liquid never runs
 * here — font URLs are relative to this file (../fonts/…) and therefore
 * correct under any baseurl. Do not add front matter.
 */
```

- [ ] **Step 5: Run the check to verify it passes**

Run: `./check.sh`
Expected: `OK: 2 files built, all internal references resolve`

If the count is higher than 2, something is leaking into the output — run `find _site -type f` and add whatever appears to `exclude:`.

- [ ] **Step 6: Prove the check actually catches the bug it exists for**

Temporarily break `_layouts/default.html` — change the stylesheet link to `href="/assets/css/style.css"` (no `relative_url`).

Run: `./check.sh`
Expected: FAIL, printing `href="/assets/css/style.css"` and `the references above are root-relative and skipped relative_url`.

Restore the `relative_url` version and re-run. Expected: OK.

A check that has never failed is not known to work.

- [ ] **Step 7: Commit**

```bash
git add check.sh _config.yml _layouts index.html assets
git commit -m "feat: jekyll skeleton with a baseurl guard

check.sh builds the site and asserts no internal href or src bypassed
relative_url, and that every internal reference resolves to a real file.
Verified by breaking the stylesheet link on purpose and watching it fail."
```

---

### Task 2: Fonts and the design system

**Files:**

- Create: `assets/fonts/fira-sans-latin-400-normal.woff2`, `-600-`, `-700-`, `fira-mono-latin-400-normal.woff2`, `assets/fonts/OFL.txt`
- Modify: `assets/css/style.css`
- Modify: `check.sh`

**Interfaces:**

- Consumes: `./check.sh` from Task 1.
- Produces: CSS custom properties on `:root` — `--ink`, `--ink-deep`, `--paper`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, `--accent-dark`, `--radius`, `--container`. Font families `--font-sans`, `--font-mono`. Later tasks use these names and must not introduce new colour literals.

- [ ] **Step 1: Extend the check to assert the fonts exist**

Add to `check.sh`, immediately before the final `echo "OK: ..."` line:

```bash
# 3. Every self-hosted font referenced by the stylesheet must be published.
for f in fira-sans-latin-400-normal fira-sans-latin-600-normal \
         fira-sans-latin-700-normal fira-mono-latin-400-normal; do
  grep -q "${f}.woff2" _site/assets/css/style.css \
    || fail "style.css does not reference ${f}.woff2"
  [ -f "_site/assets/fonts/${f}.woff2" ] \
    || fail "_site/assets/fonts/${f}.woff2 was not published"
done
[ -f _site/assets/fonts/OFL.txt ] || fail "the font licence was not published"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `./check.sh`
Expected: `FAIL: style.css does not reference fira-sans-latin-400-normal.woff2`

- [ ] **Step 3: Fetch the fonts and the licence**

These URLs were verified 2026-08-30 (the 400 face is 23,880 bytes of real WOFF2; the licence is 93 lines).

```bash
mkdir -p assets/fonts
base="https://cdn.jsdelivr.net/npm/@fontsource"
for f in 400 600 700; do
  curl -sSL "${base}/fira-sans@5.2.5/files/fira-sans-latin-${f}-normal.woff2" \
    -o "assets/fonts/fira-sans-latin-${f}-normal.woff2"
done
curl -sSL "${base}/fira-mono@5.2.5/files/fira-mono-latin-400-normal.woff2" \
  -o "assets/fonts/fira-mono-latin-400-normal.woff2"
curl -sSL "https://raw.githubusercontent.com/mozilla/Fira/master/LICENSE" \
  -o assets/fonts/OFL.txt
file assets/fonts/*.woff2
```

Expected: four lines each reading `Web Open Font Format (Version 2)`. If any file is HTML or zero bytes, the CDN failed — stop and re-fetch rather than committing a broken font.

- [ ] **Step 4: Write the design system**

Replace the body of `assets/css/style.css` (keep the header comment) with:

```css
/* ------------------------------------------------------------------ fonts -- */
/* Relative to THIS file, so they resolve under any baseurl. */

@font-face {
  font-family: "Fira Sans";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("../fonts/fira-sans-latin-400-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Fira Sans";
  font-style: normal;
  font-weight: 600;
  font-display: swap;
  src: url("../fonts/fira-sans-latin-600-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Fira Sans";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("../fonts/fira-sans-latin-700-normal.woff2") format("woff2");
}
@font-face {
  font-family: "Fira Mono";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("../fonts/fira-mono-latin-400-normal.woff2") format("woff2");
}

/* ----------------------------------------------------------------- tokens -- */
/*
 * This page is a THIRD brand: not the bank, not the shop. It hosts Sparkasse
 * red, Wero yellow and Google's badge, so the chrome stays neutral and the
 * credential artwork is the only saturated thing on screen.
 *
 * The accent belongs to the SPEC (the EudiPay/PaSO blue), not to either app,
 * so it cannot imply the page is the bank's or the shop's.
 */
:root {
  --ink: #101828;
  --ink-deep: #0b1220;
  --paper: #f7f9fc;
  --surface: #ffffff;
  --border: #dfe4ec;
  --text: #1a2233;
  --muted: #5b6678;
  --accent: #004dd7;
  --accent-dark: #003ba6;

  --radius: 12px;
  --container: 1080px;
  --measure: 68ch;

  --font-sans: "Fira Sans", system-ui, -apple-system, sans-serif;
  --font-mono: "Fira Mono", ui-monospace, SFMono-Regular, monospace;
}

/* ------------------------------------------------------------------- base -- */

*,
*::before,
*::after { box-sizing: border-box; }

html { scroll-behavior: smooth; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 17px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 {
  line-height: 1.15;
  letter-spacing: -0.02em;
  margin: 0 0 0.5em;
}

h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 700; }
h2 { font-size: clamp(1.5rem, 3vw, 2rem); font-weight: 700; }
h3 { font-size: 1.125rem; font-weight: 600; }

p { margin: 0 0 1em; max-width: var(--measure); }

a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { color: var(--accent-dark); }

code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: #eef2f8;
  border-radius: 4px;
  padding: 0.1em 0.35em;
}

:where(a, button):focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.container {
  width: 100%;
  max-width: var(--container);
  margin-inline: auto;
  padding-inline: 24px;
}

.eyebrow {
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 0.75em;
}
```

- [ ] **Step 5: Run the check to verify it passes**

Run: `./check.sh`
Expected: OK, with a file count that has grown by five (four fonts plus the licence).

- [ ] **Step 6: Commit**

```bash
git add assets/fonts assets/css/style.css check.sh
git commit -m "feat: self-hosted Fira and the design tokens

Four faces only, referenced relative to the stylesheet so they resolve under
any baseurl without Liquid. OFL text ships beside them. The accent is the
spec's blue rather than either app's colour, so the chrome cannot imply this
page belongs to the bank or the shop."
```

---

### Task 3: Layout chrome — nav, hero, footer

**Files:**

- Modify: `_layouts/default.html`
- Modify: `assets/css/style.css`
- Modify: `index.html`

**Interfaces:**

- Consumes: tokens from Task 2.
- Produces: the `.site-nav`, `.hero`, `.site-footer` classes and the four nav anchors `#what`, `#walkthrough`, `#credentials`, `#built-on`. Task 5 creates the sections these point at.

- [ ] **Step 1: Extend the check to assert the nav anchors have targets**

Add to `check.sh` before the final `echo`:

```bash
# 4. Every in-page nav anchor must have a matching id on the page.
for anchor in what walkthrough credentials built-on; do
  grep -q "href=\"#${anchor}\"" _site/index.html \
    || fail "nav is missing the #${anchor} link"
  grep -q "id=\"${anchor}\"" _site/index.html \
    || fail "no element carries id=\"${anchor}\" for the nav to reach"
done
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `./check.sh`
Expected: `FAIL: nav is missing the #what link`

- [ ] **Step 3: Write the layout**

Replace `_layouts/default.html`:

```html
<!DOCTYPE html>
<html lang="{{ site.lang | default: 'en' }}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ page.title | default: site.title }}</title>
    <meta name="description" content="{{ page.description | default: site.description }}">
    <link rel="stylesheet" href="{{ '/assets/css/style.css' | relative_url }}">
  </head>
  <body>
    <header class="site-nav">
      <div class="container site-nav__inner">
        <a class="site-nav__mark" href="{{ '/' | relative_url }}">Jumpstart</a>
        <nav aria-label="Sections">
          <a href="#what">What this is</a>
          <a href="#walkthrough">Walkthrough</a>
          <a href="#credentials">Credentials</a>
          <a href="#built-on">Built on</a>
        </nav>
      </div>
    </header>

    {{ content }}

    <footer class="site-footer">
      <div class="container">
        <p class="site-footer__org">Digitallabor Berlin</p>
        <p class="site-footer__fine">
          Fira Sans and Fira Mono are used under the
          <a href="{{ '/assets/fonts/OFL.txt' | relative_url }}">SIL Open Font License 1.1</a>.
          This page loads no third-party resources and sets no cookies.
        </p>
      </div>
    </footer>
  </body>
</html>
```

- [ ] **Step 4: Write the hero into `index.html`**

Replace `index.html`:

```html
---
layout: default
title: "Jumpstart — the EUDI wallet as a payment instrument"
---
<section class="hero">
  <div class="container">
    <p class="hero__badge">
      A reference implementation of the
      <a href="https://aptitude-consortium.github.io/payments-and-sca-for-openid/latest">PaSO specifications</a>
    </p>
    <h1>Use an EUDI wallet as a payment instrument.</h1>
    <p class="hero__lede">
      Issue payment credentials from a bank into your wallet, then spend them at
      a shop — with the amount cryptographically bound to your approval.
      Everything below runs against live deployments.
    </p>
    <p class="hero__actions">
      <a class="btn btn--primary"
         href="https://github.com/digitallabor-berlin/elpaso/releases/download/latest/elpaso-release.apk">
        Download the wallet
      </a>
      <a class="btn btn--ghost" href="https://sparkasse-musterstadt.digitallabor.dev/">
        Open the bank
      </a>
    </p>
  </div>
</section>

<main>
  <section id="what" class="section"><div class="container"><h2>What this is</h2></div></section>
  <section id="walkthrough" class="section"><div class="container"><h2>Walkthrough</h2></div></section>
  <section id="credentials" class="section"><div class="container"><h2>Credentials</h2></div></section>
  <section id="built-on" class="section"><div class="container"><h2>Built on</h2></div></section>
</main>
```

The four empty sections are placeholders **only until Task 5**, which fills them. They exist now so the nav check has targets.

- [ ] **Step 5: Style the chrome**

Append to `assets/css/style.css`:

```css
/* -------------------------------------------------------------------- nav -- */

.site-nav {
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgb(255 255 255 / 0.92);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--border);
}

.site-nav__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 56px;
}

.site-nav__mark {
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  text-decoration: none;
}

.site-nav nav {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}

.site-nav nav a {
  font-size: 0.9375rem;
  color: var(--muted);
  text-decoration: none;
}

.site-nav nav a:hover { color: var(--accent); }

/* ------------------------------------------------------------------- hero -- */
/*
 * The dark band is what makes this page its own thing rather than a page of
 * the bank's or the shop's. It is also the only place the two CTAs can be
 * loud without borrowing either app's colour.
 */
.hero {
  background: var(--ink);
  background-image: radial-gradient(
    120% 100% at 15% 0%, #16223a 0%, var(--ink-deep) 70%);
  color: #fff;
  padding-block: clamp(56px, 10vw, 96px);
}

.hero h1 { color: #fff; max-width: 18ch; }

.hero__badge {
  font-size: 0.8125rem;
  color: rgb(255 255 255 / 0.72);
  margin-bottom: 1.25em;
}

.hero__badge a { color: #9db8ff; }

.hero__lede {
  color: rgb(255 255 255 / 0.82);
  font-size: 1.0625rem;
  max-width: 56ch;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 1.75em;
  max-width: none;
}

/* ----------------------------------------------------------------- button -- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 46px;
  padding-inline: 22px;
  border-radius: var(--radius);
  font-weight: 600;
  font-size: 0.9375rem;
  text-decoration: none;
  border: 1px solid transparent;
}

.btn--primary { background: var(--accent); color: #fff; }
.btn--primary:hover { background: #1b5ce0; color: #fff; }

.btn--ghost {
  background: transparent;
  color: #fff;
  border-color: rgb(255 255 255 / 0.32);
}
.btn--ghost:hover { background: rgb(255 255 255 / 0.08); color: #fff; }

/* ---------------------------------------------------------------- section -- */

.section { padding-block: clamp(48px, 7vw, 80px); }
.section + .section { border-top: 1px solid var(--border); }

/* ----------------------------------------------------------------- footer -- */

.site-footer {
  background: var(--ink);
  color: rgb(255 255 255 / 0.66);
  padding-block: 40px;
  font-size: 0.875rem;
}

.site-footer__org { color: #fff; font-weight: 600; margin-bottom: 0.5em; }
.site-footer__fine { max-width: 60ch; }
.site-footer a { color: #9db8ff; }
```

- [ ] **Step 6: Run the check to verify it passes**

Run: `./check.sh`
Expected: OK.

- [ ] **Step 7: Look at it**

```bash
jekyll serve --baseurl "" --port 4000 &
sleep 3
open http://localhost:4000/
```

Confirm by eye: sticky nav, dark hero, two buttons, dark footer. Then `kill %1`.

Note `--baseurl ""` for local serving — the published site uses `/jumpstart`, and `check.sh` is what guards that difference.

- [ ] **Step 8: Commit**

```bash
git add _layouts/default.html index.html assets/css/style.css check.sh
git commit -m "feat: sticky nav, dark hero and footer

The dark band exists so the page reads as its own thing rather than as a page
of the bank's or the shop's, and so the two CTAs have somewhere to be loud
without borrowing either app's colour. check.sh now asserts every nav anchor
has a target on the page."
```

---

### Task 4: Content data, includes, and artwork

**Files:**

- Create: `_data/steps.yml`
- Create: `_data/credentials.yml`
- Create: `_includes/step.html`
- Create: `_includes/credential-card.html`
- Create: `assets/img/card-face.webp`, `wero-logo.svg`, `av-face.svg`, `add-to-google-wallet.svg`
- Modify: `assets/css/style.css`
- Modify: `index.html`

**Interfaces:**

- Consumes: tokens from Task 2; `.container`, `.section`, `.eyebrow` from Tasks 2–3.
- Produces: `_data/steps.yml` entries with keys `n, title, body`; `_data/credentials.yml` entries with keys `id, name, subtitle, face, art, attests, formats, wallets, google, used_for, section, body`. Task 5 iterates both. The includes expect the entry in `include.step` / `include.credential`.

- [ ] **Step 1: Extend the check to assert the data actually rendered**

Add to `check.sh` before the final `echo`:

```bash
# 5. The data files must have rendered, not merely existed.
for s in "Install the wallet" "Log in to the bank" "Issue your credentials" \
         "Log in without a password" "Pay at Larder" "See the result"; do
  grep -qF "$s" _site/index.html || fail "walkthrough step missing: ${s}"
done
for c in "Sparkassen-Card" "Wero" "Age verification" "Sparkassen Authenticator"; do
  grep -qF "$c" _site/index.html || fail "credential card missing: ${c}"
done

# 6. The Google Wallet caveat must be per-credential, never blanket.
grep -qF "non-public beta" _site/index.html \
  || fail "the Google Wallet beta caveat is absent"

# 7. Copy rules that are correctness, not style.
#    Written as `if`, not `grep && fail`: under `set -e` a non-matching grep in
#    a && list escapes exit-on-error only by a subtle rule in the manual. This
#    must be obviously right rather than subtly right.
if grep -qiE "conforms to (the )?(EMVCo|DPC)" _site/index.html; then
  fail "the page claims DPC conformance; it may only say it MODELS one"
fi
grep -qF "verifies nothing" _site/index.html \
  || fail "the page must state that the bank stores the proof and verifies nothing"
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `./check.sh`
Expected: `FAIL: walkthrough step missing: Install the wallet`

- [ ] **Step 3: Copy the artwork**

```bash
mkdir -p assets/img
src=/Users/senexi/dev/eudiw/payment-banking-demo/apps/bank/public
cp "$src/card-face.webp" "$src/wero-logo.svg" "$src/av-face.svg" \
   "$src/add-to-google-wallet.svg" assets/img/
ls -l assets/img/
```

Expected: four files, none zero bytes.

- [ ] **Step 4: Write `_data/steps.yml`**

```yaml
# The six walkthrough steps. Copy lives here so a wording fix is a YAML edit
# and never a markup edit.

- n: 1
  title: "Install the wallet"
  body: >-
    Download and install the elpaso wallet on an **Android** phone:
    [elpaso-release.apk](https://github.com/digitallabor-berlin/elpaso/releases/download/latest/elpaso-release.apk).
    You will need to allow installation from an unknown source. Everything
    that follows happens between this wallet, the bank and the shop.

- n: 2
  title: "Log in to the bank"
  body: >-
    Open [Sparkasse Musterstadt](https://sparkasse-musterstadt.digitallabor.dev/)
    and sign in as `anna` with the password `demo1234`. You land on a dashboard
    with two headings — **Payments** and **Credentials** — which is where every
    credential below is issued from.

- n: 3
  title: "Issue your credentials"
  body: >-
    Under **Payments** you will find the Sparkassen-Card and Wero; under
    **Credentials**, the age verification and the Sparkassen Authenticator.
    Issue all four — each takes one tap. Pick either handover route for any of
    them; both are described above. Two of the four also offer an *Add to
    Google Wallet* badge, which needs a **non-public beta** build of Google
    Wallet — the other two are EUDI Wallet only. What each credential actually
    contains is set out under [Credentials](#credentials).

- n: 4
  title: "Log in without a password"
  body: >-
    Sign out of the bank, then choose to log in with your wallet instead of a
    password. The bank asks for the Sparkassen Authenticator and binds the
    request to the current moment: the presentation must be signed over a
    `login_datetime`, and the bank **requires that binding back**. A wallet that
    ignored it could not log in — which is what stops a captured presentation
    from being replayed later.

- n: 5
  title: "Pay at Larder"
  body: >-
    Open [Larder](https://larder-shop.digitallabor.dev/), add a few items and
    check out. The payment sheet asks your wallet for a payment credential —
    the Sparkassen-Card or Wero, whichever you hold — with the **amount bound
    into the request**, so approving in the wallet approves that exact sum.
    Add a **Beer**, **Wine** or **Aperitif** and the shop additionally asks for
    your age credential; the rest of the shelf does not.

- n: 6
  title: "See the result"
  body: >-
    The shop settles by debiting the bank over its API. Go back to the bank and
    look under **Recent transactions** — your purchase is there, carrying the
    PaSO proof package the shop collected: the signed request object and the
    wallet's response, stored side by side. The bank marks it **Unverified**,
    which is exactly right — it keeps the evidence and verifies nothing in it.
```

- [ ] **Step 5: Write `_data/credentials.yml`**

```yaml
# The four credentials. `face` selects the card artwork treatment in CSS;
# `google` decides whether the beta caveat is shown for this credential.

- id: girocard
  name: "Sparkassen-Card"
  subtitle: "girocard"
  section: "Payments"
  face: "card"
  art: "/assets/img/card-face.webp"
  attests: "A payment card drawn on your account."
  formats: "`com.emvco.dpc.card` and `sparkassencard`"
  wallets: "EUDI Wallet and Google Wallet"
  google: true
  used_for: "Paying at Larder."
  body: >-
    Issued in **two formats that share no claims at all**. One carries
    `credential_id`, `network` and `card_id`; the other carries `sub`,
    `masked_iban` and `psu_id`. Not a superset of each other, not a rename —
    two different answers to the same question. The first models an
    [EMVCo Digital Payment Credential](https://www.emvco.com/knowledge-hub/defining-an-emv-digital-payment-credential/),
    a proposal this demo uses. Neither format ever discloses a full IBAN.

- id: wero
  name: "Wero"
  subtitle: "account-to-account payment"
  section: "Payments"
  face: "wero"
  art: "/assets/img/wero-logo.svg"
  attests: "A payment instrument drawn on your account."
  formats: "`wero`"
  wallets: "EUDI Wallet only"
  google: false
  used_for: "Paying at Larder."
  body: >-
    A second way to pay, drawn on the account itself rather than on a card. It
    carries the same claims as the Sparkassen-Card's second format — `sub`,
    `masked_iban` and `psu_id` — so the shop tells the two apart by *which
    question they answered*, never by what is inside them.

- id: age
  name: "Age verification"
  subtitle: "an attestation, not an identity"
  section: "Credentials"
  face: "age"
  art: "/assets/img/av-face.svg"
  attests: "That you are over 16, and that you are over 18. Nothing else."
  formats: "`av-sparkasse` and `av`"
  wallets: "EUDI Wallet and Google Wallet"
  google: true
  used_for: "Buying beer, wine or aperitif at Larder."
  body: >-
    Two booleans and no date of birth, no name, no document number. Issued in
    two formats whose claims are **byte-identical** — one attestation in two
    wrappers, one for each wallet. The shop learns that you are old enough and
    learns nothing else about you, which is the entire point of asking this way.

- id: authenticator
  name: "Sparkassen Authenticator"
  subtitle: "one claim, and it is not your name"
  section: "Credentials"
  face: "auth"
  art: null
  attests: "That you are an authenticated customer of this bank."
  formats: "`sparkassen_auth`"
  wallets: "EUDI Wallet only"
  google: false
  used_for: "Logging in to the bank without a password."
  body: >-
    Its entire content is a single opaque identifier, `sub`, minted fresh for
    each issuance — so two of these credentials cannot be linked to each other
    by anyone who sees both. It authorises no money: the bank refuses a debit
    against it even though it is a perfectly valid credential. Issued for 365
    days, and nothing in this demo can revoke it.
```

- [ ] **Step 6: Write the includes**

Create `_includes/step.html`:

```html
<li class="step">
  <div class="step__n" aria-hidden="true">{{ include.step.n }}</div>
  <div class="step__body">
    <h3>{{ include.step.title }}</h3>
    {{ include.step.body | markdownify }}
  </div>
</li>
```

Create `_includes/credential-card.html`:

```html
<article class="cred">
  <div class="cred__face cred__face--{{ include.credential.face }}">
    {% if include.credential.art %}
      <img src="{{ include.credential.art | relative_url }}" alt="" loading="lazy">
    {% else %}
      <span class="cred__wordmark">Authenticator</span>
    {% endif %}
  </div>

  <div class="cred__body">
    <p class="eyebrow">{{ include.credential.section }}</p>
    <h3>{{ include.credential.name }}</h3>
    <p class="cred__sub">{{ include.credential.subtitle }}</p>

    <p class="cred__attests">{{ include.credential.attests }}</p>
    {{ include.credential.body | markdownify }}

    <dl class="cred__meta">
      <dt>Formats</dt>
      <dd>{{ include.credential.formats | markdownify | strip_html | strip }}</dd>
      <dt>Wallets</dt>
      <dd>{{ include.credential.wallets }}</dd>
      <dt>Used for</dt>
      <dd>{{ include.credential.used_for }}</dd>
    </dl>

    {% if include.credential.google %}
      <p class="cred__caveat">
        <img class="cred__gbadge"
             src="{{ '/assets/img/add-to-google-wallet.svg' | relative_url }}"
             alt="Add to Google Wallet">
        Needs a <strong>non-public beta</strong> build of Google Wallet.
      </p>
    {% endif %}
  </div>
</article>
```

- [ ] **Step 7: Render them from `index.html`**

In `index.html`, replace the two placeholder sections:

```html
  <section id="walkthrough" class="section">
    <div class="container">
      <h2>Walkthrough</h2>
      <ol class="steps">
        {% for step in site.data.steps %}
          {% include step.html step=step %}
        {% endfor %}
      </ol>
    </div>
  </section>

  <section id="credentials" class="section section--alt">
    <div class="container">
      <h2>The four credentials</h2>
      <p class="section__lede">
        Two of them pay. One proves an age and nothing else. One proves you are
        a customer and authorises no money at all.
      </p>
      <div class="creds">
        {% for credential in site.data.credentials %}
          {% include credential-card.html credential=credential %}
        {% endfor %}
      </div>
    </div>
  </section>
```

- [ ] **Step 8: Style steps and cards**

Append to `assets/css/style.css`:

```css
/* ------------------------------------------------------------------ steps -- */

.steps {
  list-style: none;
  margin: 2em 0 0;
  padding: 0;
  max-width: 760px;
}

.step {
  display: grid;
  grid-template-columns: 44px 1fr;
  gap: 20px;
  padding-bottom: 32px;
  position: relative;
}

/* The rail. Drawn on the number column so it cannot drift from the numbers. */
.step:not(:last-child)::before {
  content: "";
  position: absolute;
  left: 21px;
  top: 44px;
  bottom: 0;
  width: 2px;
  background: var(--border);
}

.step__n {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  font-size: 1.0625rem;
}

.step__body h3 { margin-top: 0.35em; }
.step__body p:last-child { margin-bottom: 0; }

/* ------------------------------------------------------------ credentials -- */

.section--alt { background: var(--surface); }
.section__lede { max-width: 58ch; color: var(--muted); }

.creds {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 24px;
  margin-top: 2em;
}

.cred {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/*
 * The faces reproduce the bank's own treatments. Each ground is set
 * explicitly: the girocard is a photograph, and the other three are flat
 * brand colours that must not inherit it.
 */
.cred__face {
  aspect-ratio: 1.586;
  display: grid;
  place-items: center;
  padding: 20px;
  background-size: cover;
  background-position: center;
}

.cred__face img { max-width: 100%; max-height: 100%; }

.cred__face--card { background-color: #ea0016; padding: 0; }
.cred__face--card img { width: 100%; height: 100%; object-fit: cover; }

.cred__face--wero { background-color: #fdf494; }
.cred__face--wero img { width: 42%; }

.cred__face--age { background-color: #ffffff; }
.cred__face--age img { width: 100%; height: 100%; object-fit: cover; }

/* No artwork file exists for this one; the bank draws its name as type. */
.cred__face--auth { background-color: #ea0016; place-items: start; }

.cred__wordmark {
  color: #fff;
  font-weight: 700;
  font-size: 1.25rem;
  letter-spacing: -0.02em;
}

.cred__body { padding: 22px; }
.cred__body h3 { margin-bottom: 0.15em; }

.cred__sub {
  color: var(--muted);
  font-size: 0.9375rem;
  margin-bottom: 1em;
}

.cred__attests { font-weight: 600; }

.cred__meta {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 1.25em 0 0;
  font-size: 0.9375rem;
  border-top: 1px solid var(--border);
  padding-top: 1em;
}

.cred__meta dt { color: var(--muted); }
.cred__meta dd { margin: 0; }

.cred__caveat {
  margin: 1.25em 0 0;
  font-size: 0.875rem;
  color: var(--muted);
}

/* Height only — Google's guidelines forbid altering the badge's proportions. */
.cred__gbadge {
  display: block;
  height: 38px;
  width: auto;
  margin-bottom: 0.6em;
}
```

- [ ] **Step 9: Run the check to verify it passes**

Run: `./check.sh`
Expected: OK. If check 7 fires (`the page claims DPC conformance`), the copy is wrong, not the check — fix the copy.

- [ ] **Step 10: Commit**

```bash
git add _data _includes assets index.html check.sh
git commit -m "feat: walkthrough steps and credential cards from data

Copy lives in _data so a wording fix is a YAML edit and no card can drift out
of shape from the others. check.sh now asserts each step and card rendered,
that the Google Wallet caveat is present, that the page never claims DPC
conformance, and that it says the bank verifies nothing in the proof."
```

---

### Task 5: The remaining prose sections

**Files:**

- Modify: `index.html`
- Modify: `assets/css/style.css`

**Interfaces:**

- Consumes: everything from Tasks 2–4.
- Produces: the finished page. No new interfaces.

- [ ] **Step 1: Extend the check for the sections that carry the load-bearing claims**

Add to `check.sh` before the final `echo`:

```bash
# 8. The transports section must state both routes work in BOTH directions.
grep -qF "Digital Credentials API" _site/index.html || fail "DC API is not explained"
grep -qF "QR code" _site/index.html || fail "the QR route is not explained"
grep -qiF "issuance and verification" _site/index.html \
  || fail "the page must say both transports work for issuance AND verification"

# 9. The demo-environment band must carry the login.
grep -qF "demo1234" _site/index.html || fail "the demo login is missing"

# 10. `?dcapi=unsigned` must never be documented — it silently disables
#     the proof package. Same `if` form as check 7, for the same reason.
if grep -qF "dcapi=unsigned" _site/index.html; then
  fail "the page documents ?dcapi=unsigned; it must not"
fi
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `./check.sh`
Expected: `FAIL: DC API is not explained`

- [ ] **Step 3: Write the remaining sections**

In `index.html`, insert the demo band immediately after the hero `</section>`:

```html
<aside class="demo-band">
  <div class="container demo-band__inner">
    <div>
      <p class="eyebrow">Demo environment</p>
      <p class="demo-band__text">
        Fake customers, fake money, fake shop. Nothing here touches a real
        account and no real payment is ever made.
      </p>
    </div>
    <p class="demo-band__creds">
      Sign in as <code>anna</code> / <code>demo1234</code>
    </p>
  </div>
</aside>
```

Replace the `#what` placeholder section:

```html
  <section id="what" class="section">
    <div class="container">
      <h2>What this is</h2>
      <p>
        Two live applications showing a European Digital Identity wallet used as
        a <strong>payment instrument</strong> rather than only as an identity
        document. A bank issues payment credentials into your wallet; a shop
        asks for one at checkout and is paid.
      </p>
      <p>
        It is a reference implementation of the
        <a href="https://aptitude-consortium.github.io/payments-and-sca-for-openid/latest">Payments
        and SCA for OpenID (PaSO)</a> specifications, and it uses
        <a href="https://github.com/digitallabor-berlin/foundry">foundry</a> as its
        credential issuer and verifier.
      </p>
      <p>
        The bank is <a href="https://sparkasse-musterstadt.digitallabor.dev/">Sparkasse
        Musterstadt</a>. The shop is
        <a href="https://larder-shop.digitallabor.dev/">Larder</a>, a grocer. Both
        are running right now, and the walkthrough below is meant to be followed
        rather than read.
      </p>
    </div>
  </section>

  <section id="transports" class="section section--alt">
    <div class="container">
      <h2>Two ways the wallet is reached</h2>
      <p class="section__lede">
        Both work for <strong>issuance and verification</strong> alike — getting a
        credential into the wallet, and proving one out of it.
      </p>
      <div class="routes">
        <div class="route">
          <h3>QR code or deep link</h3>
          <p>
            <strong>Two devices.</strong> The bank or the shop is open on a laptop
            and shows a QR code; you scan it with the phone holding your wallet.
            This always works, and it is the fallback whenever the other route
            cannot be used.
          </p>
        </div>
        <div class="route">
          <h3>Digital Credentials API</h3>
          <p>
            <strong>One device.</strong> The browser hands the request straight to
            a wallet on the same phone — no QR, no scanning. Needs Chrome on
            Android. The request the wallet receives is signed by default.
          </p>
        </div>
      </div>
      <p class="note">
        On Safari the wallet button reports that issuance is not supported and a
        QR code appears instead — Safari can present a credential but cannot
        receive one.
      </p>
    </div>
  </section>
```

Replace the `#built-on` placeholder section:

```html
  <section id="built-on" class="section">
    <div class="container">
      <h2>Built on</h2>
      <ul class="links">
        <li>
          <a href="https://aptitude-consortium.github.io/payments-and-sca-for-openid/latest">Payments and SCA for OpenID</a>
          — the specifications this demo implements.
        </li>
        <li>
          <a href="https://github.com/digitallabor-berlin/foundry">foundry</a>
          — the credential issuer and verifier behind both applications.
        </li>
        <li>
          <a href="https://www.emvco.com/knowledge-hub/defining-an-emv-digital-payment-credential/">EMVCo Digital Payment Credential</a>
          — the proposal the Sparkassen-Card's first format models.
        </li>
        <li>
          <a href="https://github.com/digitallabor-berlin/elpaso">elpaso</a>
          — the wallet you install in step one.
        </li>
      </ul>
      <p class="note">
        The proof package stored against each payment is kept as evidence and
        <strong>verifies nothing</strong>: this demo records the signed request
        and the wallet's response, and runs none of PaSO's verification checks
        over them. The bank's own ledger marks it <em>Unverified</em> for that
        reason.
      </p>
    </div>
  </section>
```

- [ ] **Step 4: Style them**

Append to `assets/css/style.css`:

```css
/* -------------------------------------------------------------- demo band -- */

.demo-band {
  background: #fff8e1;
  border-bottom: 1px solid #f0e2b6;
}

.demo-band__inner {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  align-items: center;
  justify-content: space-between;
  padding-block: 18px;
}

.demo-band__text { margin: 0; max-width: 62ch; font-size: 0.9375rem; }

.demo-band__creds {
  margin: 0;
  font-size: 0.9375rem;
  white-space: nowrap;
}

.demo-band code { background: rgb(0 0 0 / 0.06); }

/* ----------------------------------------------------------------- routes -- */

.routes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-top: 2em;
}

.route {
  background: var(--paper);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 22px;
}

.route h3 { margin-top: 0; }
.route p:last-child { margin-bottom: 0; }

/* ------------------------------------------------------------------ links -- */

.links { padding-left: 1.1em; margin: 1.5em 0 0; max-width: var(--measure); }
.links li { margin-bottom: 0.5em; }

.note {
  margin-top: 1.75em;
  padding: 16px 18px;
  border-left: 3px solid var(--accent);
  background: var(--surface);
  border-radius: 0 var(--radius) var(--radius) 0;
  font-size: 0.9375rem;
  max-width: var(--measure);
}

/* ------------------------------------------------------------ small screen -- */

@media (max-width: 640px) {
  body { font-size: 16px; }

  /* The numbers must survive: they are the only thing giving the walkthrough
     its order once the rail is this narrow. */
  .step { grid-template-columns: 36px 1fr; gap: 14px; }
  .step__n { width: 36px; height: 36px; font-size: 0.9375rem; }
  .step:not(:last-child)::before { left: 17px; top: 36px; }

  .site-nav nav { gap: 14px; }
  .site-nav nav a { font-size: 0.875rem; }
  .hero__actions .btn { width: 100%; }
}
```

- [ ] **Step 5: Run the check to verify it passes**

Run: `./check.sh`
Expected: OK.

- [ ] **Step 6: Read the whole page for the copy rules**

Open `http://localhost:4000/` (`jekyll serve --baseurl ""`) and read every word against the **Copy rules** in Global Constraints. `check.sh` catches the phrasings it can grep for; it cannot catch a sentence that implies conformance without using the word. This step is the only thing that can.

- [ ] **Step 7: Commit**

```bash
git add index.html assets/css/style.css check.sh
git commit -m "feat: the remaining sections and the small-screen layout

check.sh now asserts both transports are described as working in both
directions, that the demo login is present, and that ?dcapi=unsigned is never
documented — it silently disables the proof package, so it must not appear on
a page whose last step is about that package."
```

---

### Task 6: Publish and verify against the real URL

The only task whose verification cannot be done locally. The `baseurl` class of bug appears here or nowhere.

**Files:** none created. This task pushes and verifies.

**Interfaces:**

- Consumes: a green `./check.sh` on `main`.
- Produces: a live site.

- [ ] **Step 1: Confirm the build output holds only what should be public**

```bash
cd /Users/senexi/dev/eudiw/jumpstart
./check.sh
find _site -type f | sort
git ls-tree --name-only -r main
```

Expected: `check.sh` green, and `_site` holding **only** `index.html`, the stylesheet, the fonts and the images — **no `docs/`, no `README.md`, no `check.sh`**. The repository tree still holds all three. If anything internal appears under `_site`, fix `exclude:` before pushing: this is the one guarantee the single-branch layout gives up, and the check exists to catch it.

- [ ] **Step 2: Push**

```bash
git push -u origin main
```

- [ ] **Step 3: Enable GitHub Pages — OPERATOR STEP**

This cannot be done from the working copy. Either ask the operator to set
**Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)`**,
or, with sufficient permissions:

```bash
gh api -X POST repos/digitallabor-berlin/jumpstart/pages \
  -f 'source[branch]=main' -f 'source[path]=/'
```

Then poll until it reports built:

```bash
gh api repos/digitallabor-berlin/jumpstart/pages --jq '.status, .html_url'
```

Expected eventually: `built` and `https://digitallabor-berlin.github.io/jumpstart/`.

- [ ] **Step 4: Verify the published page over real HTTP**

```bash
cd /tmp
curl -sS -o jump.html -w "status=%{http_code}\n" \
  https://digitallabor-berlin.github.io/jumpstart/

grep -c 'href="/jumpstart/' jump.html
grep -oE '(href|src)="/[^"]*"' jump.html | grep -v '"/jumpstart/' || echo "no bare root-relative refs"
```

Expected: `status=200`, a non-zero count of `/jumpstart/` references, and `no bare root-relative refs`.

Then confirm every asset actually resolves in production:

```bash
for p in assets/css/style.css \
         assets/fonts/fira-sans-latin-400-normal.woff2 \
         assets/fonts/OFL.txt \
         assets/img/card-face.webp \
         assets/img/wero-logo.svg \
         assets/img/av-face.svg \
         assets/img/add-to-google-wallet.svg; do
  printf "%-52s " "$p"
  curl -sI -o /dev/null -w "%{http_code}\n" \
    "https://digitallabor-berlin.github.io/jumpstart/$p"
done
```

Expected: `200` on every line. **A `404` here is the exact bug `check.sh` exists to prevent** — if one appears, the local check has a gap; fix the check as well as the link.

- [ ] **Step 5: Verify it renders in a real browser**

```bash
cd /tmp
cat > verify-jumpstart.mjs <<'JS'
import { withPage } from "/Users/senexi/dev/eudiw/payment-banking-demo/tools/cdp/cdp.mjs";

await withPage(async (page) => {
  await page.goto("https://digitallabor-berlin.github.io/jumpstart/");

  // The credential art carries loading="lazy" and sits below the fold, so an
  // unscrolled page reports every one of them broken. Scroll first, then wait
  // for decode, or this check fails on a page that is entirely correct.
  await page.eval(`
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise(r => setTimeout(r, 1000));
    window.scrollTo(0, 0);
    await Promise.all([...document.images].map(i => i.decode().catch(() => {})));
    return 1;
  `);

  const report = await page.eval(`
    return {
      title: document.title,
      steps: document.querySelectorAll('.step').length,
      creds: document.querySelectorAll('.cred').length,
      navLinks: [...document.querySelectorAll('.site-nav nav a')].map(a => a.hash),
      brokenAnchors: [...document.querySelectorAll('.site-nav nav a')]
        .filter(a => !document.querySelector(a.hash)).map(a => a.hash),
      brokenImages: [...document.images]
        .filter(i => !i.complete || i.naturalWidth === 0).map(i => i.currentSrc || i.src),
      heroBg: getComputedStyle(document.querySelector('.hero')).backgroundColor,
      bodyFont: getComputedStyle(document.body).fontFamily,
      gBadges: document.querySelectorAll('.cred__gbadge').length
    };
  `);
  console.log(JSON.stringify(report, null, 2));
});
JS
node verify-jumpstart.mjs
rm -f verify-jumpstart.mjs
```

Expected: `steps: 6`, `creds: 4`, `brokenAnchors: []`, `brokenImages: []`, `gBadges: 2` (the badge appears on exactly the two credentials that offer it — a count of 4 means the caveat leaked onto Wero and the Authenticator), `bodyFont` containing `Fira Sans`, and a dark `heroBg`.

- [ ] **Step 6: Check it on a narrow viewport**

Add to the same script before `console.log`, or run a second pass:

```js
await page.send("Emulation.setDeviceMetricsOverride", {
  width: 390, height: 844, deviceScaleFactor: 3, mobile: true
});
const narrow = await page.eval(`
  return {
    numbersVisible: [...document.querySelectorAll('.step__n')]
      .every(n => n.getBoundingClientRect().width > 20),
    overflowX: document.documentElement.scrollWidth > window.innerWidth
  };
`);
console.log(narrow);
```

Expected: `numbersVisible: true`, `overflowX: false`. Horizontal overflow on a phone is the most likely small-screen defect and the least visible on a laptop.

- [ ] **Step 7: Commit any fixes and record what was verified**

If steps 4–6 required changes, commit them with a message stating what was
measured — the status codes, the counts — rather than that it "works".

---

## Self-Review

**Spec coverage.** Every section of the design doc maps to a task:

| Spec section | Task |
| --- | --- |
| §2 single branch, build, theme, domain | 1, 6 |
| §3 information architecture (8 sections) | 3 (hero, chrome), 4 (steps, cards), 5 (what, demo band, transports, built-on) |
| §4.1 four credentials | 4 |
| §4.2 Google Wallet caveat, per-credential | 4 (`gBadges: 2` in Task 6 proves the "per-credential" part) |
| §4.3 six walkthrough steps | 4 |
| §4.4 transports, both directions | 5 |
| §4.5 careful claims (binding, proof unverified, DPC modelled, lifetime, no revocation) | 4 (`_data`), 5 (`built-on` note), enforced by `check.sh` checks 6–7 and 10 |
| §4.6 external references | Global Constraints table; rendered in 3, 4, 5 |
| §5 visual design | 2 (tokens, type), 3 (hero, chrome), 4 (cards), 5 (responsive) |
| §6 file layout, `baseurl`, Jekyll floor | 1 (config + guard), Global Constraints |
| §7 publishing and operator dependency | 6 |
| §8 non-goals | Enforced by `check.sh` check 10 and by omission |
| §9 risks | `baseurl` risk mitigated by checks 1–2; version gap by the feature constraint and Task 6 |

**Gap found and closed during review:** §4.5's "365 days and no revocation" had no home in any section — the walkthrough is not the place for it. It is now in the Sparkassen Authenticator's `body` in `_data/credentials.yml`, which is where a reader asking "how long does this last" would look.

**Second gap:** the spec's §3 lists eight sections but Task 3 created only four placeholder ids. The demo band and the transports section are added in Task 5 and are deliberately *not* nav targets, matching the spec's four-anchor decision.

**Placeholder scan:** no TBD/TODO. Every code step carries the actual file content. The only deliberately temporary content is Task 3's four empty sections, which Task 5 replaces and which are labelled as such.

**Type consistency** *(as built; the `face` key and the `shots` key are later changes — see the status block at the top)*: `_data/credentials.yml` keys match every reference in `_includes/credential-card.html`, and `_data/steps.yml` keys match `_includes/step.html`. The `face` key and its `cred__face--{card|wero|age|auth}` modifiers were **removed on 2026-08-31** when every credential gained a complete card face; `_data/steps.yml` gained `shots` on the same date. Current keys are `id, name, subtitle, section, art, attests, formats, wallets, google, used_for, body` and `n, title, body, shots`. `check.sh`'s `fail()` is defined in Task 1 before every later task appends calls to it.

**One known weakness, stated rather than hidden:** `check.sh` greps rendered HTML for specific strings. If Task 4's copy is reworded, the check must be reworded with it or it fails on correct content. That is the accepted cost of having any automated guard at all on a static page with no test framework.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-08-30-jumpstart-landing-page.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
