import type { CardFaceCopy, CardFaceState } from "./card-state.js";
import {
  AV_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
  type CredentialTypeId,
} from "./credential-types.js";

/**
 * Every German string the two credentials show, in one place, keyed by
 * credential type id.
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

/** The tile's badge and explanation, per credential type and face state. */
export const FACE_COPY: Record<
  CredentialTypeId,
  Record<CardFaceState, CardFaceCopy>
> = {
  [DPC_CREDENTIAL_TYPE_ID]: {
    none: {
      badge: "Nicht im Wallet",
      badgeClass: "badge-neutral",
      explain:
        "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
    },
    offered: {
      badge: "Wird hinzugefügt…",
      badgeClass: "badge-wallet",
      explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
    },
    active: {
      badge: "Im Wallet",
      badgeClass: "badge-success",
      explain: "Diese Karte ist in Ihrem EUDI Wallet und für Zahlungen bereit.",
    },
  },
  [AV_CREDENTIAL_TYPE_ID]: {
    none: {
      badge: "Nicht im Wallet",
      badgeClass: "badge-neutral",
      explain:
        "Fügen Sie Ihren Altersnachweis Ihrem EUDI Wallet hinzu, um Ihr Alter online zu bestätigen.",
    },
    offered: {
      badge: "Wird hinzugefügt…",
      badgeClass: "badge-wallet",
      explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
    },
    active: {
      badge: "Im Wallet",
      badgeClass: "badge-success",
      explain: "Ihr Altersnachweis ist in Ihrem EUDI Wallet und einsatzbereit.",
    },
  },
};

/**
 * The issuance dialog's copy. A `subject: string` prop would not have worked:
 * German gender differs — "die Karte" against "der Altersnachweis" — so the
 * article and the possessive change with the noun, not just the noun.
 */
export const DIALOG_COPY: Record<CredentialTypeId, IssuanceCopy> = {
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
};