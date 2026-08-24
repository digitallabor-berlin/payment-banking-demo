import type { Credential } from "../db/schema.js";

/**
 * The credential type ids this bank issues, spelled exactly as foundry's admin
 * API names them.
 *
 * These live in their own module rather than in `issuance.ts` so `payments.ts`
 * can name the payment types without importing the issuance path, which would
 * drag in the foundry client, `env`, and the display-metadata builders — none
 * of which a debit has any business touching.
 *
 * `satisfies` binds each literal to the schema's enum, so widening the column
 * without updating these (or the reverse) is a compile error rather than a
 * branch that silently never runs.
 */
export type CredentialTypeId = Credential["credentialTypeId"];

/** The EMVCo Digital Payment Credential. */
export const DPC_CREDENTIAL_TYPE_ID =
 "com.emvco.dpc.card" satisfies CredentialTypeId;

/**
 * The bank's own card credential — the same girocard in a second format,
 * resolving to `https://creds.digitallabor.dev/vct/sparkassencard` on foundry's
 * side. Payable like the DPC, but it carries an entirely different claim set:
 * see `payment-claims.ts`.
 */
export const SPARKASSEN_CARD_CREDENTIAL_TYPE_ID =
 "sparkassencard" satisfies CredentialTypeId;

/**
 * The age-verification attestation, in the bank's own format. NOT
 * `eu.europa.ec.av.1` — that is the mdoc docType configured on foundry's side;
 * this is the credential type id the admin API takes.
 *
 * The age tile's EUDI Wallet button issues this one.
 */
export const AV_CREDENTIAL_TYPE_ID = "av-sparkasse" satisfies CredentialTypeId;

/**
 * The same age attestation, in the profile the Google Wallet badge hands over.
 *
 * This is the bare `av` id — the value the age credential was issued under
 * before `av-sparkasse` existed. It is no longer a legacy spelling: it is a
 * second live format alongside it, carrying the identical `AV_CLAIMS`, which is
 * why `getAgeCredentialState` now resolves it instead of ignoring it. A
 * pre-existing `av` row therefore reads as in-wallet in this format, where it
 * previously read as "not in wallet".
 */
export const AV_GOOGLE_CREDENTIAL_TYPE_ID = "av" satisfies CredentialTypeId;

/**
 * The age-credential formats, in the order the age tile presents them: the
 * bank's own EUDI button first, the Google Wallet badge second.
 *
 * Two formats for the same reason the girocard has two — one handover per
 * wallet — but unlike the card these share their entire claim set, so there is
 * no per-format claims module here. What they do NOT share is tile state: see
 * `AgeCredentialDto.formats`.
 */
export const AGE_CREDENTIAL_TYPE_IDS = [
 AV_CREDENTIAL_TYPE_ID,
 AV_GOOGLE_CREDENTIAL_TYPE_ID,
] as const;

export type AgeCredentialTypeId = (typeof AGE_CREDENTIAL_TYPE_IDS)[number];

/**
 * The credential types that authorize money to move, in the order the card tile
 * presents them.
 *
 * `processPayment` reads this rather than naming one type, so adding a third
 * card format is a one-line change here instead of a guard that silently keeps
 * rejecting it.
 */
export const PAYMENT_CREDENTIAL_TYPE_IDS = [
 DPC_CREDENTIAL_TYPE_ID,
 SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
] as const;

export type PaymentCredentialTypeId =
 (typeof PAYMENT_CREDENTIAL_TYPE_IDS)[number];

/**
 * Whether a stored row is a payment credential.
 *
 * Takes a plain `string` rather than `CredentialTypeId` on purpose: one caller
 * is the issuance route, validating a value that arrived over HTTP, and the
 * other reads a column whose legacy values outlive the union.
 */
export function isPaymentCredentialType(
 typeId: string,
): typeId is PaymentCredentialTypeId {
 return (PAYMENT_CREDENTIAL_TYPE_IDS as readonly string[]).includes(typeId);
}

/**
 * Whether a value names one of the age-credential formats.
 *
 * The sibling of `isPaymentCredentialType`, and deliberately disjoint from it:
 * this one gates an attestation about a person, that one gates money moving.
 * Takes a plain `string` for the same reason — its caller is the AV issuance
 * route, validating a value that arrived over HTTP.
 */
export function isAgeCredentialType(
 typeId: string,
): typeId is AgeCredentialTypeId {
 return (AGE_CREDENTIAL_TYPE_IDS as readonly string[]).includes(typeId);
}

/**
 * Whether an issuance of this type may carry the DPC display metadata.
 *
 * foundry gates `offer_display` and `credential_response_display` on the
 * resolved credential type's vct (`create_offer.rs`) and rejects them outright
 * for anything else. A rejection is not a card missing its artwork — the offer
 * is never created and the attempt lands as a `failed` row. So this is a hard
 * safety guard, not a presentation preference, which is why it is a named
 * predicate with its own test rather than a comparison inline in `issuance.ts`.
 */
export function sendsDpcDisplayMetadata(
 typeId: PaymentCredentialTypeId,
): boolean {
 return typeId === DPC_CREDENTIAL_TYPE_ID;
}
