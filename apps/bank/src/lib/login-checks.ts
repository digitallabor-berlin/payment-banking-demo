import type { PresentedCredential } from "@demo/foundry-client";
import { SPARKASSEN_AUTH_QUERY_ID } from "./credential-types.js";

/** foundry's name for the check that the KB-JWT signed over transaction_data. */
const BINDING_CHECK = "transaction_data_binding";

/**
 * The pure half of the login gate. A sibling of the merchant's `checks.ts` and
 * held to the same rule: everything is keyed by DCQL query id.
 *
 * Separated from `login-sessions.ts` so it is testable without a database and
 * without a foundry stub — every vitest project here is `environment: "node"`
 * with `include: ["src/**\/*.test.ts"]`, and a decision buried in an I/O
 * function is a decision with no test of its own.
 */

/**
 * The presented credential that answered the authenticator query, or null.
 *
 * A `find` on `query_id`, never `credentials[0]` and never "whichever one has
 * a `sub`". Today the query requests exactly one credential, so a laxer rule
 * would be observationally identical — it exists so that widening the query
 * later cannot silently promote a payment credential's `sub` into an
 * authentication subject.
 */
export function findAuthenticatorCredential(
  credentials: PresentedCredential[] | undefined,
): PresentedCredential | null {
  if (!credentials) return null;
  return (
    credentials.find(
      (credential) => credential.query_id === SPARKASSEN_AUTH_QUERY_ID,
    ) ?? null
  );
}

/**
 * The `sub` the authenticator credential disclosed, or null.
 *
 * Fails closed at every step: no credential, non-object claims, a missing
 * `sub`, an empty `sub` and a non-string `sub` all return null, and the caller
 * turns null into a failed login. The deployed foundry declares `sub` as
 * `required: true` with `selectively_disclosable: false`, so a verified
 * verdict should always carry one — but no wallet has ever been observed
 * answering this query, so the shape is enforced rather than trusted.
 */
export function extractAuthSubject(
  credentials: PresentedCredential[] | undefined,
): string | null {
  const credential = findAuthenticatorCredential(credentials);
  if (!credential) return null;

  const claims = credential.claims;
  if (typeof claims !== "object" || claims === null) return null;

  const subject = (claims as Record<string, unknown>)["sub"];
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}

/**
 * True only if foundry explicitly reported `transaction_data_binding` as passed
 * **on the credential that answered the authenticator query**.
 *
 * The twin of the merchant's `passedTransactionDataBinding`, and closed the
 * same way: absence reads as failure. Sending a login datetime the bank never
 * confirms was signed over buys nothing at all — an unbound `vp_token` is as
 * replayable as one with no `transaction_data` in the request — so a foundry
 * that stops reporting the check must lock logins out rather than wave them
 * through.
 *
 * Reads `credentials[i].checks`, never the top-level `checks` array. That array
 * is cross-cutting only (`jwe_decryption`, `requested_credentials_answered`)
 * and structurally cannot hold this check; searching it would fail every login.
 *
 * Scoped through `findAuthenticatorCredential` rather than "any credential with
 * the check", so a neighbouring payment credential's binding — bound to an
 * amount, not to this login — can never satisfy the gate.
 */
export function passedLoginBinding(
  credentials: PresentedCredential[] | undefined,
): boolean {
  const credential = findAuthenticatorCredential(credentials);
  if (!credential) return false;

  const checks: unknown = credential.checks;
  if (!Array.isArray(checks)) return false;

  return checks.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>)["check"] === BINDING_CHECK &&
      (entry as Record<string, unknown>)["passed"] === true,
  );
}