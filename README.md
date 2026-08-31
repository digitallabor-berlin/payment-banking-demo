# Jumpstart

A single page that walks you through the **payment-banking demo** — a digital
wallet supporting OpenID4VC, used as a payment instrument — from installing the
wallet to seeing a completed purchase in the bank's ledger.

**→ <https://digitallabor-berlin.github.io/payment-banking-demo/>**

It covers installing the [elpaso wallet](https://github.com/digitallabor-berlin/elpaso),
issuing the four credentials from
[Sparkasse Musterstadt](https://sparkasse-musterstadt.digitallabor.dev/),
logging in without a password, and paying at
[Larder](https://larder-shop.digitallabor.dev/).

The demo is a reference implementation of the
[PaSO specifications](https://aptitude-consortium.github.io/payments-and-sca-for-openid/latest)
and uses [foundry](https://github.com/digitallabor-berlin/foundry) as its
issuer and verifier.

## This repository

The site lives on the `gh-pages` branch, which is orphaned — it shares no
history with `main`, where the demo's own source lives. GitHub Pages serves
this branch's root.

| Path | Holds |
| --- | --- |
| `index.html`, `_layouts/`, `_includes/`, `_data/`, `assets/` | The site. |
| `docs/` | The design doc and the implementation plan. Not published. |
| `_src/` | Image masters plus `optimize.sh`, which regenerates the served webp. Not published. |
| `check.sh` | Builds the site and asserts what only breaks in production. Not published. |

`docs/`, `README.md` and `check.sh` are listed under `exclude:` in `_config.yml`,
so they stay out of the published output. `./check.sh` asserts that, because a
deleted `exclude:` entry would publish the design doc with no visible symptom.

The site is plain Jekyll with no theme gem and no plugins, built by GitHub Pages
itself — there is no build step to run and nothing to install. `./check.sh`
needs a local `jekyll` if you want to run it.

The demo's own source lives on `main` in this same repository. That branch is
not published; only `gh-pages` is.
