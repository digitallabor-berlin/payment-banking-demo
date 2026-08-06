/** The check name foundry reports for amount binding (spec §6.2 step 8). */
const BINDING_CHECK = "transaction_data_binding";

/**
 * True only if foundry explicitly reported `transaction_data_binding` as
 * passed. Absence reads as failure, deliberately: the entire value of
 * transaction_data is lost if the merchant settles without confirming this
 * specific check, so a foundry that stopped reporting it must fail closed.
 */
export function passedTransactionDataBinding(checks: unknown): boolean {
  if (!Array.isArray(checks)) return false;
  return checks.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { check?: unknown }).check === BINDING_CHECK &&
      (entry as { passed?: unknown }).passed === true,
  );
}

/**
 * Pulls `credential_id` out of foundry's disclosed claims. Handles both a
 * shape keyed by the DCQL query id (`{ card: { credential_id } }`) and a flat
 * one, because the exact nesting is the one part of foundry's verification
 * response this project has not yet observed against a real presentation —
 * issuance was confirmed in Plan 1 Task 1, verification claims were not.
 * Step 11 of this task pins down which shape is real; once observed, delete
 * the branch that does not occur and tighten this function.
 */
export function extractCredentialId(claims: unknown): string | null {
  if (typeof claims !== "object" || claims === null) return null;

  const flat = (claims as { credential_id?: unknown }).credential_id;
  if (typeof flat === "string") return flat;

  const nested = (claims as { card?: unknown }).card;
  if (typeof nested === "object" && nested !== null) {
    const value = (nested as { credential_id?: unknown }).credential_id;
    if (typeof value === "string") return value;
  }

  return null;
}