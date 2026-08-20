import type { CardFaceCopy, CardFaceState } from "./card-state.js";
import {
  AV_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
  type CredentialTypeId,
} from "./credential-types.js";
import type { Locale } from "./i18n/locale.js";

/**
 * Every string the two credentials show, in both languages, in one place,
 * keyed by locale and then by credential type id.
 *
 * It lives in a `.ts` module rather than inside the components for the reason
 * that governs this whole app: every vitest project is `environment: "node"`
 * with `include: ["src/**\/*.test.ts"]`, so a string decided in a `.tsx` file
 * is never covered by a test. A third credential type gets a third entry here
 * and no new component-level branching.
 */

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

/** The tile's badge and explanation, per locale, credential type and face state. */
export const FACE_COPY: Record<
  Locale,
  Record<CredentialTypeId, Record<CardFaceState, CardFaceCopy>>
> = {
  en: {
    [DPC_CREDENTIAL_TYPE_ID]: {
      none: {
        badge: "Not in wallet",
        explain: "Add this card to your EUDI Wallet to pay online.",
      },
      offered: {
        badge: "Being added…",
        explain: "Confirm the offer in your wallet app.",
      },
      active: {
        badge: "In wallet",
        explain: "This card is in your EUDI Wallet and ready for payments.",
      },
    },
    [AV_CREDENTIAL_TYPE_ID]: {
      none: {
        badge: "Not in wallet",
        explain:
          "Add your age verification to your EUDI Wallet to confirm your age online.",
      },
      offered: {
        badge: "Being added…",
        explain: "Confirm the offer in your wallet app.",
      },
      active: {
        badge: "In wallet",
        explain:
          "Your age verification is in your EUDI Wallet and ready to use.",
      },
    },
  },
  de: {
    [DPC_CREDENTIAL_TYPE_ID]: {
      none: {
        badge: "Nicht im Wallet",
        explain:
          "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
      },
      offered: {
        badge: "Wird hinzugefügt…",
        explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
      },
      active: {
        badge: "Im Wallet",
        explain:
          "Diese Karte ist in Ihrem EUDI Wallet und für Zahlungen bereit.",
      },
    },
    [AV_CREDENTIAL_TYPE_ID]: {
      none: {
        badge: "Nicht im Wallet",
        explain:
          "Fügen Sie Ihren Altersnachweis Ihrem EUDI Wallet hinzu, um Ihr Alter online zu bestätigen.",
      },
      offered: {
        badge: "Wird hinzugefügt…",
        explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
      },
      active: {
        badge: "Im Wallet",
        explain:
          "Ihr Altersnachweis ist in Ihrem EUDI Wallet und einsatzbereit.",
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
  Record<CredentialTypeId, IssuanceCopy>
> = {
  en: {
    [DPC_CREDENTIAL_TYPE_ID]: {
      title: "Add card to EUDI Wallet",
      successTitle: "Card added",
      successBody: "Your card is now in your EUDI Wallet.",
      failureBody: "The card could not be added.",
    },
    [AV_CREDENTIAL_TYPE_ID]: {
      title: "Add age verification to EUDI Wallet",
      successTitle: "Age verification added",
      successBody: "Your age verification is now in your EUDI Wallet.",
      failureBody: "The age verification could not be added.",
    },
  },
  de: {
    [DPC_CREDENTIAL_TYPE_ID]: {
      title: "Karte zum EUDI Wallet hinzufügen",
      successTitle: "Karte hinzugefügt",
      successBody: "Ihre Karte ist jetzt in Ihrem EUDI Wallet.",
      failureBody: "Die Karte konnte nicht hinzugefügt werden.",
    },
    [AV_CREDENTIAL_TYPE_ID]: {
      title: "Altersnachweis zum EUDI Wallet hinzufügen",
      successTitle: "Altersnachweis hinzugefügt",
      successBody: "Ihr Altersnachweis ist jetzt in Ihrem EUDI Wallet.",
      failureBody: "Der Altersnachweis konnte nicht hinzugefügt werden.",
    },
  },
};

export function faceCopy(
  locale: Locale,
  typeId: CredentialTypeId,
  state: CardFaceState,
): CardFaceCopy {
  return FACE_COPY[locale][typeId][state];
}

export function dialogCopy(
  locale: Locale,
  typeId: CredentialTypeId,
): IssuanceCopy {
  return DIALOG_COPY[locale][typeId];
}
