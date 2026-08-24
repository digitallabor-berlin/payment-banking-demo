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
 * Wero — the bank's account-to-account payment credential.
 *
 * Payable like the two girocard formats, and it reuses their non-DPC claim set
 * (`{ sub, masked_iban, psu_id }`), but it is NOT a format of the girocard: it
 * is a separate instrument with its own tile and its own artwork. That
 * distinction is what `CARD_FORMAT_TYPE_IDS` exists to keep — see below.
 *
 * Offered for the EUDI Wallet only. There is no Google Wallet handover for it,
 * so unlike the card and the age credential it has exactly one button and
 * therefore no per-format tile state to track.
 */
export const WERO_CREDENTIAL_TYPE_ID = "wero" satisfies CredentialTypeId;

/**
 * The Sparkassen Authenticator — a credential that attests the holder is an
 * authenticated Sparkasse customer, and nothing else.
 *
 * Spelled with an underscore, unlike every other id here. That is foundry's
 * spelling and not a choice.
 *
 * Deliberately in none of the lists below. It is not payable, so it must never
 * reach `processPayment`; it is not an age attestation either. What it shares
 * with the age credential is its *shape* rather than its meaning: no card, no
 * join key, one claim about the person. Its only claim is a `sub` UUID minted
 * per issuance and never persisted, so nothing about it is correlatable across
 * issuances — see `authenticator-issuance.ts`.
 *
 * Offered for the EUDI Wallet only, so — like Wero — it has exactly one button
 * and therefore no per-format tile state to track.
 */
export const SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID =
 "sparkassen_auth" satisfies CredentialTypeId;

/**
 * The foundry NAMED QUERY the bank presents when authenticating a customer.
 *
 * Deliberately a separate constant from `SPARKASSEN_AUTH_QUERY_ID` below, even
 * though the deployed config spells both the same. A named query lives in
 * foundry's `named_queries` registry; a DCQL credential query id lives inside
 * that query's own `dcql.credentials[]`. Nothing makes them agree — the
 * merchant's `payment` query answers `dpc`, `sparkassencard` and `wero`, none
 * of which is its own name — so one constant serving both roles would make a
 * rename of either silently mis-key the other.
 */
export const SPARKASSEN_AUTH_NAMED_QUERY = "sparkassen_auth";

/**
 * The DCQL credential query id inside that named query — the value
 * `PresentedCredential.query_id` carries for an authenticator presentation.
 *
 * Every read of a login verdict is keyed by THIS, never by the presence of a
 * `sub` claim: `sparkassencard` and `wero` both declare `sub`, and a
 * claim-name collision must never decide who gets logged in.
 */
export const SPARKASSEN_AUTH_QUERY_ID = "sparkassen_auth";

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
 * The formats of the ONE girocard, in the order the card tile presents them:
 * the Google Wallet badge's DPC, then the EUDI button's `sparkassencard`.
 *
 * Deliberately narrower than `PAYMENT_CREDENTIAL_TYPE_IDS`. "What can pay" and
 * "what is a format of this card" were the same question while the girocard was
 * the only payment instrument; Wero separated them. `listCards` and
 * `CardDto.formats` must read THIS one — scoping them to every payment type
 * would make the girocard's face and badge read "In wallet" because a Wero
 * credential exists, which is a lie about a different instrument.
 */
export const CARD_FORMAT_TYPE_IDS = [
 DPC_CREDENTIAL_TYPE_ID,
 SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
] as const;

export type CardFormatTypeId = (typeof CARD_FORMAT_TYPE_IDS)[number];

/**
 * The credential types that authorize money to move: every format of the
 * girocard, plus Wero.
 *
 * `processPayment` reads this rather than naming one type, so admitting a new
 * instrument is a one-line change here instead of a guard that silently keeps
 * rejecting it. The card route's parser reads it too, which is what makes
 * `POST /api/cards/{id}/credential` accept a Wero issuance without a new route.
 */
export const PAYMENT_CREDENTIAL_TYPE_IDS = [
 ...CARD_FORMAT_TYPE_IDS,
 WERO_CREDENTIAL_TYPE_ID,
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
 * Whether a value names the Sparkassen Authenticator.
 *
 * The third sibling of `isPaymentCredentialType` and `isAgeCredentialType`, and
 * disjoint from both: the three gate three different capabilities, and an id
 * answering true to two of them would let one credential do another's job —
 * one of those jobs being to move money.
 *
 * Takes a plain `string` for the same reason the other two do: its caller
 * validates a value that arrived over HTTP.
 *
 * A single-member predicate rather than an inline `=== SPARKASSEN_AUTH_…`
 * because the comparison must be identical at every site that asks it, and
 * because a second authenticator format — should one ever exist — then widens
 * one function instead of every call site.
 */
export function isAuthenticatorCredentialType(
 typeId: string,
): typeId is typeof SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID {
 return typeId === SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID;
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
