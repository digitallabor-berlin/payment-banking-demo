import { randomBytes, randomUUID } from "node:crypto";
import {
 DPC_CREDENTIAL_TYPE_ID,
 type PaymentCredentialTypeId,
} from "./credential-types.js";

/**
 * The opaque value carried inside the DPC credential and returned by the wallet
 * at checkout. 18 random bytes encode to exactly 24 base64url characters with
 * no padding — roughly 144 bits, far beyond guessing range.
 */
export function mintCredentialId(): string {
 return `dpc_${randomBytes(18).toString("base64url")}`;
}

/**
 * The join key for one payment issuance, in the shape its format's claim
 * demands.
 *
 * The DPC's `credential_id` is opaque, so it keeps the prefixed base64url form
 * above — the prefix is worth having in a log line. The Sparkasse card's
 * `psu_id` is contractually a UUID, and a `dpc_`-prefixed value there would be
 * both malformed and a lie about which credential minted it.
 *
 * A named decision rather than a ternary at the call site: this is the kind of
 * per-format divergence that would be silently wrong rather than loudly broken,
 * so it gets its own test.
 */
export function mintJoinKey(typeId: PaymentCredentialTypeId): string {
 return typeId === DPC_CREDENTIAL_TYPE_ID ? mintCredentialId() : randomUUID();
}
