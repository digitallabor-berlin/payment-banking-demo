import {
 DPC_CREDENTIAL_TYPE_ID,
 type PaymentCredentialTypeId,
} from "./credential-types.js";
import { ibanLastFour } from "./display-metadata.js";

/**
 * The claims each payment credential carries.
 *
 * The two formats share nothing: the EMVCo DPC declares
 * `{ credential_id, network, card_id }`, while
 * `https://creds.digitallabor.dev/vct/sparkassencard` declares
 * `{ sub, masked_iban, psu_id }`. Not a superset, not a rename — a different
 * claim set for the same girocard.
 *
 * This is a pure builder with its own tests rather than an object literal
 * inline in `issuance.ts`, for the reason that governs the whole app: every
 * vitest project is `environment: "node"` with `include: ["src/**\/*.test.ts"]`,
 * so a claim shape decided anywhere else is never covered. It is also the one
 * place that can assert the negative — that a DPC never carries a `psu_id` and
 * that neither format ever discloses a full IBAN.
 */

export interface PaymentClaimsInput {
 card: { id: string; network: string };
 /** The IBAN of the account the card is drawn on — the source of `masked_iban`. */
 iban: string;
 /**
  * The opaque value the wallet will disclose at checkout, and the value stored
  * in the row's `credential_id` column. Each format spells it differently:
  * `credential_id` on the DPC, `psu_id` on the Sparkasse card.
  */
 joinKey: string;
 /** The `sub` claim. Generated per issuance and never persisted. */
 subjectId: string;
}

/**
 * An IBAN rendered for a human: country code, masked body, last four digits.
 *
 * The tail comes from `ibanLastFour` rather than a second `slice`, so the four
 * digits shown by the Sparkasse card's `masked_iban` and by the DPC's
 * `card.last_four` are derived once and cannot drift apart. That also inherits
 * its throw-on-non-numeric-tail guard: a malformed value here must fail loudly
 * where the error names the offending IBAN.
 *
 * The mask is a fixed shape rather than one `*` per hidden character. It is a
 * display string, and a variable-length one would leak the IBAN's length —
 * which identifies the issuing country's format.
 */
export function maskIban(iban: string): string {
 const compact = iban.replace(/\s+/g, "");
 const country = compact.slice(0, 2).toUpperCase();
 return `${country}** **** ${ibanLastFour(compact)}`;
}

/**
 * The claims for one payment issuance.
 *
 * Takes the whole input for both formats rather than a per-format shape: the
 * caller has all of it either way, and one signature keeps the branch here —
 * where it is tested — instead of at the call site.
 */
export function buildPaymentClaims(
 typeId: PaymentCredentialTypeId,
 input: PaymentClaimsInput,
): Record<string, string> {
 if (typeId === DPC_CREDENTIAL_TYPE_ID) {
  return {
   credential_id: input.joinKey,
   network: input.card.network,
   card_id: input.card.id,
  };
 }

 return {
  sub: input.subjectId,
  masked_iban: maskIban(input.iban),
  psu_id: input.joinKey,
 };
}
