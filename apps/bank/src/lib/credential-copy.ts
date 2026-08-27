import type { CardFaceCopy, CardFaceState } from "./card-state.js";
import type { Locale } from "./i18n/locale.js";
import { MESSAGES } from "./i18n/messages.js";

/**
 * Every string the bank's credentials show, in both languages, in one place.
 *
 * It lives in a `.ts` module rather than inside the components for the reason
 * that governs this whole app: every vitest project is `environment: "node"`
 * with `include: ["src/**\/*.test.ts"]`, so a string decided in a `.tsx` file
 * is never covered by a test.
 *
 * Keyed by what the copy actually varies with, which is NOT the credential type
 * id. The girocard is issued in two formats and a tile shows one badge for
 * both, so face copy varies by *kind*; the dialog additionally names the wallet
 * it is handing over to, so it varies by *flavour*. Keying either by type id
 * would duplicate identical German and English strings across the two card
 * formats and let them drift.
 */

/**
 * What a tile is about. One tile, one kind, however many formats behind it.
 *
 * `wero` is a kind of its own rather than a third `card` format: it is a
 * separate instrument with its own tile and its own artwork, so its copy has to
 * name it. That it happens to be payable, like the girocard, is a fact about
 * `PAYMENT_CREDENTIAL_TYPE_IDS`, not about what a tile says.
 *
 * `authenticator` is a kind for the same reason: its own tile, its own artwork,
 * and copy that has to name it. What it is NOT is a second `age` — both attest
 * something about the person and neither can pay, but one asserts an age and
 * the other an identity, and a shared string would say the wrong thing about
 * one of them.
 */
export type CredentialKind = "card" | "age" | "wero" | "authenticator";

/**
 * One issuance conversation — a kind plus the wallet it targets.
 *
 * The `-google` flavours exist because a dialog reading "Add … to Google
 * Wallet" over a handover the user started from the plain wallet button is
 * simply wrong, and vice versa. Both tiles offer both buttons, so both kinds
 * have both flavours.
 *
 * The `-eudi` suffix is now a name for "the bank's own button" rather than a
 * description of its copy: those flavours' strings say "wallet" and name no
 * scheme. It is an internal id nothing renders, so it is left alone — renaming
 * it would touch every tile and route for no user-visible gain.
 */
export type IssuanceFlavour =
  | "card-eudi"
  | "card-google"
  | "age-eudi"
  | "age-google"
  | "wero-eudi"
  | "authenticator-eudi";

/** The copy the issuance dialog needs, which differs by grammatical gender. */
export interface IssuanceCopy {
  title: string;
  successTitle: string;
  successBody: string;
  failureBody: string;
}

/**
 * The badge's CSS class per face state.
 *
 * Locale-independent, and deliberately NOT a member of CardFaceCopy: a class
 * name has no language, and storing it inside the locale-keyed record would
 * duplicate it and permit the two locales to drift on a non-linguistic value.
 */
export const BADGE_CLASS: Record<CardFaceState, string> = {
  none: "badge-neutral",
  offered: "badge-wallet",
  active: "badge-success",
};

/** The tile's badge and explanation, per locale, credential kind and face state. */
export const FACE_COPY: Record<
  Locale,
  Record<CredentialKind, Record<CardFaceState, CardFaceCopy>>
> = {
  en: {
    card: {
      none: {
        badge: "Not in wallet",
        explain: "Add this card to your wallet to pay online.",
      },
      offered: {
        badge: "Being added…",
        explain: "Confirm the offer in your wallet app.",
      },
      active: {
        badge: "In wallet",
        explain:
          "This card is in your wallet and ready for payments. You can add it again at any time.",
      },
    },
    age: {
      none: {
        badge: "Not in wallet",
        explain:
          "Add your age verification to your wallet to confirm your age online.",
      },
      offered: {
        badge: "Being added…",
        explain: "Confirm the offer in your wallet app.",
      },
      active: {
        badge: "In wallet",
        // Names no wallet, for the same reason the card's active state does not:
        // the credential can arrive through either of the tile's two buttons.
        explain:
          "Your age verification is in your wallet and ready to use. You can add it again at any time.",
      },
    },
    wero: {
      none: {
        badge: "Not in wallet",
        explain: "Add Wero to your wallet to pay from your account.",
      },
      offered: {
        badge: "Being added…",
        explain: "Confirm the offer in your wallet app.",
      },
      active: {
        badge: "In wallet",
        // Unlike the other two kinds this tile has only the one button, so
        // naming a scheme here would be defensible — it is left unnamed
        // anyway, because an OpenID4VCI offer is answered by whichever wallet
        // the device hands it to, and the bank never learns which.
        explain:
          "Wero is in your wallet and ready for payments. You can add it again at any time.",
      },
    },
    authenticator: {
      none: {
        badge: "Not in wallet",
        // Says what it is FOR — signing in — rather than what it contains. Its
        // only claim is an opaque `sub`, so there is nothing else to describe.
        explain:
          "Add the Sparkassen Authenticator to your wallet to prove it is you online.",
      },
      offered: {
        badge: "Being added…",
        explain: "Confirm the offer in your wallet app.",
      },
      active: {
        badge: "In wallet",
        // Names no wallet, for the reason every other active string here does
        // not: an OpenID4VCI offer is answered by whichever wallet the device
        // hands it to, and the bank never learns which.
        explain:
          "The Sparkassen Authenticator is in your wallet and ready to use. You can add it again at any time.",
      },
    },
  },
  de: {
    card: {
      none: {
        badge: "Nicht im Wallet",
        explain:
          "Fügen Sie diese Karte Ihrem Wallet hinzu, um online zu bezahlen.",
      },
      offered: {
        badge: "Wird hinzugefügt…",
        explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
      },
      active: {
        badge: "Im Wallet",
        explain:
          "Diese Karte ist in Ihrem Wallet und für Zahlungen bereit. Sie können sie jederzeit erneut hinzufügen.",
      },
    },
    age: {
      none: {
        badge: "Nicht im Wallet",
        explain:
          "Fügen Sie Ihren Altersnachweis Ihrem Wallet hinzu, um Ihr Alter online zu bestätigen.",
      },
      offered: {
        badge: "Wird hinzugefügt…",
        explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
      },
      active: {
        badge: "Im Wallet",
        explain:
          "Ihr Altersnachweis ist in Ihrem Wallet und einsatzbereit. Sie können ihn jederzeit erneut hinzufügen.",
      },
    },
    wero: {
      none: {
        badge: "Nicht im Wallet",
        explain:
          "Fügen Sie Wero Ihrem Wallet hinzu, um von Ihrem Konto zu bezahlen.",
      },
      offered: {
        badge: "Wird hinzugefügt…",
        explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
      },
      active: {
        badge: "Im Wallet",
        explain:
          "Wero ist in Ihrem Wallet und für Zahlungen bereit. Sie können es jederzeit erneut hinzufügen.",
      },
    },
    authenticator: {
      none: {
        badge: "Nicht im Wallet",
        explain:
          "Fügen Sie den Sparkassen Authenticator Ihrem Wallet hinzu, um sich online auszuweisen.",
      },
      offered: {
        badge: "Wird hinzugefügt…",
        explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
      },
      active: {
        badge: "Im Wallet",
        explain:
          "Der Sparkassen Authenticator ist in Ihrem Wallet und einsatzbereit. Sie können ihn jederzeit erneut hinzufügen.",
      },
    },
  },
};

/**
 * The issuance dialog's copy. A `subject: string` prop would not have worked:
 * German gender differs — "die Karte" against "der Altersnachweis" — so the
 * article and the possessive change with the noun, not just the noun. English
 * has no such constraint, but the structure stays because German needs it.
 */
export const DIALOG_COPY: Record<
  Locale,
  Record<IssuanceFlavour, IssuanceCopy>
> = {
  en: {
    "card-eudi": {
      title: "Add card to wallet",
      successTitle: "Card added",
      // Byte-identical to card-google's below, and correctly so: the reason
      // that one never named Google applies to every flavour — the bank cannot
      // observe which app answered the offer. Only the TITLE, which states an
      // intent rather than an outcome, can differ between the two buttons.
      successBody: "Your card is now in your wallet.",
      failureBody: "The card could not be added.",
    },
    "card-google": {
      title: "Add card to Google Wallet",
      successTitle: "Card added",
      // Deliberately does not name Google Wallet. This is an OpenID4VCI offer;
      // which app answered it is not something the bank can observe, and
      // claiming otherwise would be the one string here that is not true.
      successBody: "Your card is now in your wallet.",
      failureBody: "The card could not be added.",
    },
    "age-eudi": {
      title: "Add age verification to wallet",
      successTitle: "Age verification added",
      successBody: "Your age verification is now in your wallet.",
      failureBody: "The age verification could not be added.",
    },
    "age-google": {
      title: "Add age verification to Google Wallet",
      successTitle: "Age verification added",
      // Names no wallet, exactly as card-google does not: the bank cannot
      // observe which app answered the offer.
      successBody: "Your age verification is now in your wallet.",
      failureBody: "The age verification could not be added.",
    },
    // No `wero-google` counterpart: Wero has one button, so a second flavour
    // would be copy for a button that does not exist. The authenticator below
    // has no counterpart for exactly the same reason.
    "wero-eudi": {
      title: "Add Wero to wallet",
      successTitle: "Wero added",
      successBody: "Wero is now in your wallet.",
      failureBody: "Wero could not be added.",
    },
    "authenticator-eudi": {
      title: "Add Sparkassen Authenticator to wallet",
      successTitle: "Sparkassen Authenticator added",
      successBody: "The Sparkassen Authenticator is now in your wallet.",
      failureBody: "The Sparkassen Authenticator could not be added.",
    },
  },
  de: {
    "card-eudi": {
      title: "Karte zum Wallet hinzufügen",
      successTitle: "Karte hinzugefügt",
      successBody: "Ihre Karte ist jetzt in Ihrem Wallet.",
      failureBody: "Die Karte konnte nicht hinzugefügt werden.",
    },
    "card-google": {
      title: "Karte zu Google Wallet hinzufügen",
      successTitle: "Karte hinzugefügt",
      successBody: "Ihre Karte ist jetzt in Ihrem Wallet.",
      failureBody: "Die Karte konnte nicht hinzugefügt werden.",
    },
    "age-eudi": {
      title: "Altersnachweis zum Wallet hinzufügen",
      successTitle: "Altersnachweis hinzugefügt",
      successBody: "Ihr Altersnachweis ist jetzt in Ihrem Wallet.",
      failureBody: "Der Altersnachweis konnte nicht hinzugefügt werden.",
    },
    "age-google": {
      title: "Altersnachweis zu Google Wallet hinzufügen",
      successTitle: "Altersnachweis hinzugefügt",
      successBody: "Ihr Altersnachweis ist jetzt in Ihrem Wallet.",
      failureBody: "Der Altersnachweis konnte nicht hinzugefügt werden.",
    },
    "wero-eudi": {
      title: "Wero zum Wallet hinzufügen",
      successTitle: "Wero hinzugefügt",
      successBody: "Wero ist jetzt in Ihrem Wallet.",
      failureBody: "Wero konnte nicht hinzugefügt werden.",
    },
    "authenticator-eudi": {
      title: "Sparkassen Authenticator zum Wallet hinzufügen",
      successTitle: "Sparkassen Authenticator hinzugefügt",
      successBody: "Der Sparkassen Authenticator ist jetzt in Ihrem Wallet.",
      failureBody:
        "Der Sparkassen Authenticator konnte nicht hinzugefügt werden.",
    },
  },
};

export function faceCopy(
  locale: Locale,
  kind: CredentialKind,
  state: CardFaceState,
): CardFaceCopy {
  return FACE_COPY[locale][kind][state];
}

export function dialogCopy(
  locale: Locale,
  flavour: IssuanceFlavour,
): IssuanceCopy {
  return DIALOG_COPY[locale][flavour];
}

/**
 * The label on the one button beside a credential.
 *
 * Credential-independent — "Add to wallet" says nothing about what is being
 * added, because the tile's heading and face already do — so this reads the
 * shared catalog rather than FACE_COPY. It is that button's label only:
 * the Google Wallet badge is artwork and carries its text in the SVG, so
 * `MESSAGES[locale].issuance.addToGoogleWallet` is its accessible name rather
 * than a rendered string.
 *
 * It exists as a function here, rather than a ternary in the tiles' JSX, for
 * the reason that governs every decision in this app: vitest runs
 * `environment: "node"` with `include: ["src/**\/*.test.ts"]`, so a branch
 * taken inside a `.tsx` file is never covered by a test. Two tiles read it, so
 * they also cannot disagree.
 *
 * `active` gets its own label instead of a disabled button. Re-issuance was
 * always supported by everything behind the UI — neither issuance route nor
 * `startIssuance`/`startAvIssuance` has an "already active" guard, and
 * `listCards`/`getAgeCredentialState` resolve the newest non-failed row on
 * purpose so a re-issue supersedes its predecessor — and this is a demo whose
 * whole point is being run repeatedly.
 */
export function walletActionLabel(
  locale: Locale,
  state: CardFaceState,
  pending: boolean,
): string {
  const copy = MESSAGES[locale].issuance;
  if (pending) return copy.preparing;
  return state === "active" ? copy.addAgain : copy.addToWallet;
}
