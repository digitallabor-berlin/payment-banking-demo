import type { Credential } from "../db/schema.js";

/**
 * The credential type ids this bank issues, spelled exactly as foundry's admin
 * API names them.
 *
 * These live in their own module rather than in `issuance.ts` so `payments.ts`
 * can name the payment type without importing the issuance path, which would
 * drag in the foundry client, `env`, and the display-metadata builders — none
 * of which a debit has any business touching.
 *
 * `satisfies` binds each literal to the schema's enum, so widening the column
 * without updating these (or the reverse) is a compile error rather than a
 * branch that silently never runs.
 */
export type CredentialTypeId = Credential["credentialTypeId"];

/** The EMVCo Digital Payment Credential. */
export const DPC_CREDENTIAL_TYPE_ID = "com.emvco.dpc.card" satisfies CredentialTypeId;

/**
 * The age-verification attestation. NOT `eu.europa.ec.av.1` — that is the mdoc
 * docType configured on foundry's side; this is the credential type id the
 * admin API takes.
 */
export const AV_CREDENTIAL_TYPE_ID = "av" satisfies CredentialTypeId;