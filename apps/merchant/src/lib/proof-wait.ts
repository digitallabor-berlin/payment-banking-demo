/**
 * How long the settle path waits for a proof package before debiting without
 * one.
 *
 * Three of the browser's ~2s status polls. foundry's webhook is dispatched at
 * the moment the wallet's response is submitted, which is normally well before
 * our next poll observes `verified` — so this window is slack for an unlucky
 * ordering, not an expected delay. It is deliberately small: a shopper waiting
 * is a worse outcome than a transaction without an audit artefact.
 */
export const PROOF_GRACE_MS = 6_000;

/**
 * Whether the settle path should hold off debiting and let the next poll retry.
 *
 * Pure, and in `.ts`, because every vitest project here is
 * `environment: "node"` with a `src/**` `.test.ts` include — this decision
 * written inline in `refreshPaymentSessionState` would still be exercised, but
 * only through a database and a stubbed bank, which is how a boundary condition
 * goes unnoticed.
 *
 * Every branch except one fails FORWARD, i.e. toward settling. A missing
 * `verifiedAt` and a clock that appears to run backwards both mean "debit now":
 * the package is an audit artefact, and no artefact is worth a payment that
 * never completes.
 */
export function shouldWaitForProof(
 hasPackage: boolean,
 verifiedAt: number | null,
 now: number,
): boolean {
 if (hasPackage) return false;
 if (verifiedAt === null) return false;
 const elapsed = now - verifiedAt;
 if (elapsed < 0) return false;
 return elapsed < PROOF_GRACE_MS;
}