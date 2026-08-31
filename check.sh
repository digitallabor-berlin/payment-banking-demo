#!/usr/bin/env bash
#
# Build the site and assert the things that only break in production.
#
# Two failure modes are invisible locally and obvious to a visitor:
#
#   1. An internal href or src that skipped `relative_url` resolves fine on a
#      local server rooted at / and 404s under GitHub Pages' /payment-banking-demo/
#      prefix.
#      Nothing about the local render reveals it.
#
#   2. The site shares a branch with docs/, which holds the internal design doc
#      and implementation plan. Only `exclude:` in _config.yml keeps them off
#      the public web root. Deleting that key publishes them silently.
#
# See the design doc, sections 6 and 9.
set -euo pipefail

BASEURL="/payment-banking-demo"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

rm -rf _site
jekyll build --quiet || fail "jekyll build exited non-zero"

[ -f _site/index.html ] || fail "_site/index.html was not built"

# Every built page, not just the home page. The site gained /imprint/ on
# 2026-08-31; scanning only index.html would leave a whole page unguarded
# against the one failure mode this script exists for.
mapfile -t PAGES < <(find _site -type f -name '*.html' | sort)
[ "${#PAGES[@]}" -ge 2 ] ||
  fail "expected at least 2 built pages (home and imprint), found ${#PAGES[@]}"

# 1. No root-relative reference may bypass the baseurl prefix.
if grep -ohE '(href|src)="/[^"]*"' "${PAGES[@]}" | grep -v "\"${BASEURL}/"; then
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
  # A directory reference like /imprint/ is served by the index.html inside it.
  if [ -d "_site${path}" ]; then
    [ -f "_site${path%/}/index.html" ] || {
      echo "missing: ${ref} (directory with no index.html)" >&2
      missing=1
    }
    continue
  fi
  if [ ! -e "_site${path}" ]; then
    echo "missing: ${ref}" >&2
    missing=1
  fi
done < <(grep -ohE '(href|src)="'"${BASEURL}"'[^"]*"' "${PAGES[@]}" |
  sed -E 's/^(href|src)="//; s/"$//' | sort -u)
[ "$missing" -eq 0 ] || fail "internal references point at files that do not exist"

# 3. The internal spec and plan must not be published. On a single branch this
#    is guaranteed only by `exclude:` in _config.yml — assert the outcome.
[ ! -e _site/docs ] || fail "_site/docs exists — docs/ is being published; check exclude: in _config.yml"
[ ! -e _site/README.md ] || fail "_site/README.md exists — check exclude: in _config.yml"
[ ! -e _site/check.sh ] || fail "_site/check.sh exists — check exclude: in _config.yml"

# 4. Every self-hosted font referenced by the stylesheet must be published.
for f in fira-sans-latin-400-normal fira-sans-latin-600-normal \
  fira-sans-latin-700-normal fira-mono-latin-400-normal; do
  grep -q "${f}.woff2" _site/assets/css/style.css ||
    fail "style.css does not reference ${f}.woff2"
  [ -f "_site/assets/fonts/${f}.woff2" ] ||
    fail "_site/assets/fonts/${f}.woff2 was not published"
done
[ -f _site/assets/fonts/OFL.txt ] || fail "the font licence was not published"

# 5. Every in-page nav anchor must have a matching id on the page.
for anchor in what walkthrough credentials built-on; do
  grep -q "href=\"#${anchor}\"" _site/index.html ||
    fail "nav is missing the #${anchor} link"
  grep -q "id=\"${anchor}\"" _site/index.html ||
    fail "no element carries id=\"${anchor}\" for the nav to reach"
done

# 6. The data files must have rendered, not merely existed.
for s in "Install the wallet" "Log in to the bank" "Issue your credentials" \
  "Log in without a password" "Pay at Larder" "See the result"; do
  grep -qF "$s" _site/index.html || fail "walkthrough step missing: ${s}"
done
for c in "Sparkassen-Card" "Wero" "Age verification" "Sparkassen Authenticator"; do
  grep -qF "$c" _site/index.html || fail "credential card missing: ${c}"
done

# 7. The Google Wallet caveat must be per-credential, never blanket.
grep -qF "non-public beta" _site/index.html ||
  fail "the Google Wallet beta caveat is absent"

# 8. Copy rules that are correctness, not style.
#    Written as `if`, not `grep && fail`: under `set -e` a non-matching grep in
#    a && list escapes exit-on-error only by a subtle rule in the manual. This
#    must be obviously right rather than subtly right.
if grep -qiE "conforms to (the )?(EMVCo|DPC)" _site/index.html; then
  fail "the page claims DPC conformance; it may only say it MODELS one"
fi
# 8b. The page must never claim the stored proof package is verified.
#
#     The page used to state the opposite outright — "verifies nothing" — and
#     this check asserted that sentence was present. The client removed it on
#     2026-08-31 because it read as an apology for a missing feature. That is
#     their call to make, but it changes what can be enforced: the obligation
#     from apps/bank/src/db/schema.ts is "no UI copy may imply otherwise", so
#     the guard is now the inverse. Silence is permitted; a claim is not.
#
#     Deliberately narrow. The page legitimately says "verifier" (foundry is
#     one) and "issuance and verification" (both transports do both), so a bare
#     grep for "verif" would fail on correct copy.
if grep -qiE '(proof[^.]{0,60}(verified|validated))|((verifies|validates)[^.]{0,60}proof)' \
  "${PAGES[@]}"; then
  fail "copy claims the proof package is verified; the bank stores it and checks nothing in it"
fi

# 9. The transports section must state both routes work in BOTH directions.
grep -qF "Digital Credentials API" _site/index.html || fail "DC API is not explained"
grep -qF "QR code" _site/index.html || fail "the QR route is not explained"
grep -qiF "issuance and verification" _site/index.html ||
  fail "the page must say both transports work for issuance AND verification"

# 10. The demo-environment band must carry the login.
grep -qF "demo1234" _site/index.html || fail "the demo login is missing"

# 11. `?dcapi=unsigned` must never be documented — it silently disables
#     the proof package. Same `if` form as check 8, for the same reason.
if grep -qF "dcapi=unsigned" _site/index.html; then
  fail "the page documents ?dcapi=unsigned; it must not"
fi

# 12. The page does not describe the wallet as an EUDI wallet. The demo works
#     with any wallet that speaks OpenID4VC, and naming the EU scheme implies a
#     conformance and a scope the demo does not have. (This slot previously
#     guarded the `formats` field's markdownify wrapper; that field was removed
#     on 2026-08-31, so the old check could no longer fail.)
if grep -qiE 'EUDI|European Digital Identity' _site/index.html; then
  fail "the page calls it an EUDI wallet; say OpenID4VC wallet instead"
fi

# 13. The EMVCo DPC reference belongs to "Built on" and nowhere else.
#     Linking it from the Sparkassen-Card invites the reader to infer that the
#     card conforms to the proposal. The card names its own format ids and says
#     nothing about EMVCo; exactly one link to the explainer may exist.
dpc_links=$(grep -oF 'https://www.emvco.com/knowledge-hub/defining-an-emv-digital-payment-credential/' _site/index.html | wc -l | tr -d ' ')
[ "$dpc_links" = "1" ] ||
  fail "the EMVCo DPC explainer is linked ${dpc_links} times; it belongs only in Built on"

# 14. The image masters must never be served. Everything under assets/img is a
#     webp derivative or an svg; the masters in _src/img are png and jpeg, so a
#     master copied to the wrong directory is exactly a png or jpeg appearing
#     here. Asserting the format catches that; asserting _site/_src would not,
#     because Jekyll never publishes an underscore directory in the first place
#     and the check could not fail.
if find _site/assets/img -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) | grep .; then
  fail "the files above are masters, not derivatives — put them in _src/img and run _src/optimize.sh"
fi

# 15. No served asset may exceed 150 KB. This is the guard that actually bites:
#     dropping a master into assets/img/ instead of _src/img/ builds green,
#     looks identical on a laptop, and quietly costs a phone several megabytes.
while IFS= read -r asset; do
  bytes=$(wc -c <"$asset" | tr -d ' ')
  [ "$bytes" -le 153600 ] ||
    fail "${asset} is ${bytes} bytes; regenerate it with _src/optimize.sh (limit 150 KB)"
done < <(find _site/assets -type f ! -name '*.woff2')

# 16. The walkthrough figures and the two stack logos must have rendered.
shots=$(grep -c 'class="shot ' _site/index.html || true)
[ "$shots" = "11" ] ||
  fail "expected 11 step screenshots, found ${shots} — check the shots: keys in _data/steps.yml"
for logo in foundry-logo.webp elpaso-logo.webp; do
  grep -qF "$logo" _site/index.html || fail "the ${logo} mark is missing from Built on"
done

# 17. Every credential must carry its card face. The include no longer has a
#     no-artwork branch, so a missing or renamed file renders an empty img
#     rather than falling back to anything — silent on a laptop with a warm
#     cache, an empty box for everyone else.
for face in sparkassencard wero av authenticator; do
  grep -qF "credentials/${face}.webp" _site/index.html ||
    fail "the ${face} card face is missing from the credential list"
done
faces=$(grep -c 'class="cred__face"' _site/index.html || true)
[ "$faces" = "4" ] ||
  fail "expected 4 credential faces, found ${faces}"

# 18. The payment schemes carry their disclaimer. Wero and the Sparkassen-Card
#     are real products; this page models them for a demo and says nothing
#     about what the real ones do. That is a claim about other people's
#     products, so it does not get to go missing quietly.
grep -qF 'worked examples of a' _site/index.html ||
  fail "the Wero / Sparkassen-Card disclaimer is missing from the credentials section"

# 19. The legal notice must exist, be reachable from every page, and still
#     carry the details that make it a legal notice. An imprint that is not
#     linked is not an imprint, and one that has quietly lost the register
#     entry or the VAT id is worse than none: it looks compliant and is not.
[ -f _site/imprint/index.html ] ||
  fail "_site/imprint/index.html was not built — check the permalink in imprint.html"

for page in "${PAGES[@]}"; do
  grep -qF "${BASEURL}/imprint/" "$page" ||
    fail "${page} does not link the legal notice; it must be reachable from every page"
done

while IFS='|' read -r label needle; do
  grep -qF "$needle" _site/imprint/index.html ||
    fail "the legal notice no longer states the ${label}"
done <<'LEGAL'
publisher|Deutscher Sparkassen- und Giroverband e.V.
registered address|Charlottenstraße 47
contact email|info@dsgv.de
register entry|Amtsgericht Berlin Charlottenburg, VR 35468 B
VAT id|DE122125325
LEGAL

# The section nav is in-page anchors, so it must NOT appear away from the
# walkthrough — four links to sections that do not exist on this page.
if grep -qF 'href="#walkthrough"' _site/imprint/index.html; then
  fail "the legal notice carries the walkthrough section nav; those anchors are dead here"
fi

echo "OK: $(find _site -type f | wc -l | tr -d ' ') files built, all internal references resolve"
