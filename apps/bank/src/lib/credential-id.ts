import { randomBytes } from "node:crypto";

/**
 * The opaque value carried inside the DPC credential and returned by the wallet
 * at checkout. 18 random bytes encode to exactly 24 base64url characters with
 * no padding — roughly 144 bits, far beyond guessing range.
 */
export function mintCredentialId(): string {
  return `dpc_${randomBytes(18).toString("base64url")}`;
}