#!/usr/bin/env bash
#
# Regenerate the served artwork from the masters in _src/img/.
#
# The masters are 2048px logos and 1008x2244 / 3024x1964 screenshots — 6.2 MB
# in total. This page is meant to be followed on a phone, over whatever
# connection a conference has, so what ships is a resized webp derivative and
# the masters stay here, excluded from the build (see `exclude:` in
# _config.yml). Re-run this after replacing or adding a master.
#
# Widths are twice the largest size each image is ever displayed at, so they
# stay sharp on a 2x screen and no larger.
set -euo pipefail

cd "$(dirname "$0")/.."

src="_src/img"
out="assets/img"
mkdir -p "$out/screenshots" "$out/credentials"

# label            master                      width  quality
phone_shots="
google_wallet_age_payment_credentials
payment_and_age_dc_api
payment_multi_wallet_selection
payment_start
wallet_add_credential
wallet_issuance_dcapi
wallet_login_dcapi
wallet_login_deeplink
wallet_payment_age_deeplink
"

# Phone captures: displayed at most ~300px wide in the step figures.
for name in $phone_shots; do
  cwebp -quiet -q 78 -resize 640 0 \
    "$src/screenshots/${name}.png" -o "$out/screenshots/${name}.webp"
done

# Laptop captures: displayed at most ~800px wide.
cwebp -quiet -q 80 -resize 1600 0 \
  "$src/screenshots/larder_store.png" -o "$out/screenshots/larder_store.webp"
cwebp -quiet -q 80 -resize 1600 0 \
  "$src/bank.png" -o "$out/screenshots/bank.webp"

# Credential card faces. Native is ~700px and they are displayed at 272px on a
# laptop and at most ~358px on a phone, so 2x is already covered — no resize,
# just the format change. Quality is higher than the screenshots because these
# are the artwork the page is built around rather than supporting evidence.
for name in sparkassencard wero av authenticator; do
  cwebp -quiet -q 86 \
    "$src/credentials/${name}.png" -o "$out/credentials/${name}.webp"
done

# Logos: displayed at 44px square, so 192px covers 2x with room to spare.
cwebp -quiet -q 90 -resize 192 0 "$src/foundry_logo.png" -o "$out/foundry-logo.webp"
cwebp -quiet -q 90 -resize 192 0 "$src/elpaso_logo.jpeg" -o "$out/elpaso-logo.webp"

echo "regenerated:"
du -ch "$out"/screenshots/*.webp "$out"/credentials/*.webp \
  "$out"/foundry-logo.webp "$out"/elpaso-logo.webp | tail -1
