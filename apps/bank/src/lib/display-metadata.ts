/**
 * EMVCo DPC display metadata for the bank's issuance offers.
 *
 * foundry accepts two independent arrays on `POST /admin/issuance/offers` and
 * validates each against a DIFFERENT rule set (`display_metadata.rs`):
 *
 * - `offer_display` → `DisplayStage::Offer`: `card.last_four` and
 *   `card.card_art` are optional, because the governing annex's offer-stage
 *   guidance says PII-type data should not appear on a Credential Offer.
 * - `credential_response_display` → `DisplayStage::CredentialResponse`: both are
 *   REQUIRED, `last_four` matching `^[0-9]{4}$`.
 *
 * Validation is all-or-nothing: any deviation is `400 invalid_request` and the
 * offer is never created, so a malformed member surfaces as a failed issuance
 * rather than as a card missing its artwork. That is why the builders here are
 * pure functions with their own tests instead of object literals inline in
 * `issuance.ts` — every vitest project is `environment: "node"` with
 * `include: ["src/**\/*.test.ts"]`, so decisions have to live in `.ts` to be
 * covered at all.
 *
 * These are brand assets, not configuration: they are deliberately module
 * constants rather than env vars, unlike anything with a per-deployment value.
 * The one exception is the card art, which lives on the bank's own origin and
 * therefore comes from `BANK_PUBLIC_URL` via `cardArtUrl`.
 */

export const SPARKASSE_LOGO_URL =
 "https://files.digitallabor.dev/logos/sparkasse.svg";
export const GIROCARD_LOGO_URL =
 "https://files.digitallabor.dev/logos/girocard.svg";

/** One display object per locale is all foundry permits; this is that locale. */
const LOCALE = "en-US";

/** The product name, distinct from a single card's `alias`. */
const PRODUCT_NAME = "Sparkassen Card";

/** Sparkasse red — the same value `--color-primary` carries in `globals.css`. */
const BACKGROUND_COLOR = "#EA0016";
const TEXT_COLOR = "#FFFFFF";

/**
 * Branding for the networks this demo knows. A network absent from this map
 * still yields a VALID `network_branding` entry: `branding.name` is the only
 * required member and `logo` is optional, so an unknown network degrades to a
 * name-only branding rather than failing the whole offer.
 */
const NETWORK_LOGOS: Record<string, string> = {
 girocard: GIROCARD_LOGO_URL,
};

/** The subset of a `cards` row that display metadata is derived from. */
export interface DisplayCard {
 network: string;
 cardAlias: string;
}

export interface CredentialResponseDisplayInput {
 card: DisplayCard;
 /** The IBAN of the account the card is drawn on — the source of `last_four`. */
 iban: string;
 cardArtUrl: string;
}

/**
 * The last four digits of an IBAN, for `card.last_four`.
 *
 * Throws rather than returning a fallback: foundry enforces `^[0-9]{4}$` and
 * rejects the entire offer, so a non-numeric tail must fail here — where the
 * error names the offending IBAN — instead of surfacing as an opaque 400. The
 * invariant that makes this unreachable in practice is enforced on the fixtures
 * themselves (see `db/seed.test.ts`), since `seed` is the only writer of
 * `accounts`.
 */
export function ibanLastFour(iban: string): string {
 const compact = iban.replace(/\s+/g, "");
 const tail = compact.slice(-4);
 if (!/^[0-9]{4}$/.test(tail)) {
  throw new Error(
   `IBAN does not end in four digits, so card.last_four cannot be derived: ${iban}`,
  );
 }
 return tail;
}

/**
 * The card artwork URL for `card.card_art`. `public/card-face.webp` is the real
 * artwork the bank's own UI draws; the wallet renders the same image, so it must
 * be an absolute URL on a publicly reachable origin.
 */
export function cardArtUrl(bankPublicUrl: string): string {
 return `${bankPublicUrl.replace(/\/+$/, "")}/card-face.webp`;
}

function networkBranding(network: string): Record<string, unknown> {
 const logoUrl = NETWORK_LOGOS[network];
 // `name` is the only required member; `logo` is omitted rather than sent empty,
 // because an empty `logo` array is itself a validation failure in foundry.
 const branding: Record<string, unknown> = { name: network };
 if (logoUrl) branding.logo = [{ theme: "DEFAULT", image_url: logoUrl }];
 return { network, branding };
}

/** The members both stages share. */
function baseEntry(card: DisplayCard): Record<string, unknown> {
 return {
  name: PRODUCT_NAME,
  locale: LOCALE,
  background_color: BACKGROUND_COLOR,
  text_color: TEXT_COLOR,
  logo: { uri: SPARKASSE_LOGO_URL },
  card: {
   type: { code: "DEBIT", label: PRODUCT_NAME },
   issuer: {
    branding: {
     name: "Sparkasse Musterstadt",
     logo: [{ theme: "DEFAULT", image_url: SPARKASSE_LOGO_URL }],
    },
    country: "DE",
    website_url: "https://digitallabor.berlin",
    support_email: "support@digitallabor.berlin",
   },
   network_branding: [networkBranding(card.network)],
  },
 };
}

/**
 * Offer-stage display. Carries no `last_four`, no `alias` and no `card_art` —
 * all three are PII-type members the annex keeps off a Credential Offer, and
 * `DisplayStage::Offer` is the reason foundry accepts their absence.
 */
export function buildOfferDisplay(card: DisplayCard): unknown[] {
 return [baseEntry(card)];
}

/**
 * Response-stage display. Adds the three members the offer withholds; the
 * `last_four` derivation may throw for an IBAN whose tail is not numeric.
 */
export function buildCredentialResponseDisplay(
 input: CredentialResponseDisplayInput,
): unknown[] {
 const entry = baseEntry(input.card);
 const card = entry.card as Record<string, unknown>;

 entry.card = {
  ...card,
  last_four: ibanLastFour(input.iban),
  alias: input.card.cardAlias,
  card_art: [{ theme: "DEFAULT", image_url: input.cardArtUrl }],
 };

 return [entry];
}
