import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * One event from foundry's verification-artifact webhook, normalised.
 *
 * Two normalisations happen here and nowhere else. foundry serialises absent
 * artefacts with `skip_serializing_if`, so a payload with
 * `include_raw_artifacts` off omits the KEY rather than sending null — both
 * become `null`. And the wire's snake_case becomes camelCase, so the spec's
 * names survive only where they are the spec's: inside the proof package.
 *
 * `result` and `state` are deliberately dropped. The merchant already has
 * foundry's verdict from its own poll of the admin API, and that poll is what
 * the settle gates read. A second copy arriving over an at-most-once channel
 * would be a second source of truth for the decision that moves money.
 */
export type VerifierEvent =
 | {
    event: "presentation_request_delivered";
    txId: string;
    transport: string;
    /** The PaSO `signed_request`. Null when foundry's artefact gate is off. */
    signedRequest: string | null;
   }
 | {
    event: "verification_completed";
    txId: string;
    /** The PaSO `vp_token`. Null when foundry's artefact gate is off. */
    vpToken: unknown;
   };

const SIGNATURE_PREFIX = "sha256=";

/**
 * Whether `header` is an HMAC-SHA256 of **exactly** `rawBody` under `secret`.
 *
 * `rawBody` must be the string from `request.text()`, never a re-serialised
 * `request.json()`: foundry signs the bytes it transmits, and parse-then-
 * stringify is not byte-preserving (key order, whitespace, number formatting).
 * This mirrors foundry's own constraint that its sink calls `.body(..)`.
 *
 * Every rejection returns false rather than throwing — including a length
 * mismatch, which `timingSafeEqual` throws on, and a non-hex header, which
 * `Buffer.from(_, "hex")` silently truncates. A malformed header from an
 * unauthenticated caller must not be able to produce a 500.
 */
export function verifyWebhookSignature(
 rawBody: string,
 header: string | null,
 secret: string,
): boolean {
 if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false;
 const provided = header.slice(SIGNATURE_PREFIX.length);
 // `Buffer.from("zz", "hex")` yields an empty buffer rather than throwing, so
 // the hex shape is checked explicitly instead of inferred from the decode.
 if (!/^[0-9a-f]{64}$/.test(provided)) return false;

 const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
 const a = Buffer.from(provided, "hex");
 const b = Buffer.from(expected, "hex");
 if (a.length !== b.length) return false;
 return timingSafeEqual(a, b);
}

function asString(value: unknown): string | null {
 return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Reads one webhook body into a `VerifierEvent`, or `null` when it is not one
 * we act on.
 *
 * `null` covers three different situations on purpose, because the route treats
 * them identically — store nothing, answer 2xx: a malformed body, a body
 * missing `tx_id`, and an `event` a later foundry added. Distinguishing them
 * would only let the route return a status foundry does not read.
 */
export function parseVerifierEvent(body: unknown): VerifierEvent | null {
 if (typeof body !== "object" || body === null) return null;
 const raw = body as Record<string, unknown>;

 const txId = asString(raw.tx_id);
 if (!txId) return null;

 if (raw.event === "presentation_request_delivered") {
  return {
   event: "presentation_request_delivered",
   txId,
   transport: asString(raw.transport) ?? "",
   signedRequest: asString(raw.request_object_jws),
  };
 }

 if (raw.event === "verification_completed") {
  return {
   event: "verification_completed",
   txId,
   vpToken: raw.vp_token === undefined ? null : raw.vp_token,
  };
 }

 return null;
}