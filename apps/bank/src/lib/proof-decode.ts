/**
 * Reads a stored PaSO proof package into something a human can look at.
 *
 * Pure and total: every function returns a result value and NOTHING throws.
 * These artefacts came from a wallet the bank has never met, through a verifier
 * whose output the bank does not validate (design D4) — so "I could not read
 * this" is an ordinary answer, and a dialog that 500s on a malformed token is a
 * worse outcome than one that says so.
 *
 * In `.ts` rather than inside the dialog because vitest here is
 * `environment: "node"` and never matches `.tsx`. A decoder written in the
 * component would be untested by construction.
 *
 * Decoding is for DISPLAY ONLY. Nothing here verifies a signature, and no
 * caller may treat a successful decode as evidence of anything.
 */

export interface DecodeFailure {
 ok: false;
 /** Short, technical, and shown beside the raw bytes. Not user copy. */
 reason: string;
}

export interface JwsParts {
 ok: true;
 header: unknown;
 payload: unknown;
 /**
  * The signature segment, left base64url-encoded on purpose: it is a
  * signature over bytes, not a document, and rendering it as text would
  * invite someone to read it as one.
  */
 signature: string;
}

export type JwsResult = JwsParts | DecodeFailure;

/** base64url per RFC 4648 §5, unpadded — the only alphabet JOSE permits. */
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/**
 * base64url → text, using ONLY globals a browser has.
 *
 * `Buffer` is deliberately not used, and this is not a style preference: the
 * sole consumer of this module is `ProofDialog`, a client component, and
 * `Buffer` does not exist there. A `Buffer` reference inside the `try` below
 * does not crash — it is a `ReferenceError` the `catch` swallows — so the
 * decoder degrades to "could not decode base64url" on EVERY artefact while
 * this suite, which runs in `environment: "node"`, keeps passing. That exact
 * no-op shipped once and was found in a browser, not by a test.
 *
 * `atob` yields a BINARY string, one char per byte, so the bytes go through a
 * `TextDecoder` rather than being read as text: without that, every non-ASCII
 * claim is mangled ("Müller" → "MÃ¼ller").
 */
function base64UrlToText(segment: string): string {
 const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
 const padded = base64.padEnd(
  base64.length + ((4 - (base64.length % 4)) % 4),
  "=",
 );
 const binary = atob(padded);
 const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
 return new TextDecoder().decode(bytes);
}

function decodeSegment(segment: string): { ok: true; value: unknown } | DecodeFailure {
 // The alphabet is checked first, always: `atob` throws on some invalid input
 // and silently accepts other invalid input, so neither its throwing nor its
 // returning is evidence the segment was well-formed.
 if (!BASE64URL.test(segment)) return { ok: false, reason: "not base64url" };
 let text: string;
 try {
  text = base64UrlToText(segment);
 } catch {
  return { ok: false, reason: "could not decode base64url" };
 }
 try {
  return { ok: true, value: JSON.parse(text) };
 } catch {
  return { ok: false, reason: "not JSON" };
 }
}

/** Splits a compact JWS into its decoded header and payload. */
export function decodeJwsCompact(value: string): JwsResult {
 const segments = value.split(".");
 if (segments.length !== 3) {
  return { ok: false, reason: `expected 3 segments, got ${segments.length}` };
 }
 const [rawHeader, rawPayload, signature] = segments as [string, string, string];

 const header = decodeSegment(rawHeader);
 if (!header.ok) return { ok: false, reason: `header: ${header.reason}` };
 const payload = decodeSegment(rawPayload);
 if (!payload.ok) return { ok: false, reason: `payload: ${payload.reason}` };

 return { ok: true, header: header.value, payload: payload.value, signature };
}

export type DisclosureResult = { ok: true; value: unknown } | DecodeFailure;

export interface SdJwtView {
 kind: "sd-jwt";
 issuerJwt: JwsResult;
 /** Each is `[salt, name, value]` or `[salt, value]` per SD-JWT §4.2. */
 disclosures: DisclosureResult[];
 /** Null when the presentation ends in a bare `~`, i.e. no key binding. */
 kbJwt: JwsResult | null;
}

export interface OpaqueView {
 kind: "opaque";
 /** Shown verbatim. An `mso_mdoc` presentation is base64url CBOR. */
 value: string;
}

export type PresentationView = SdJwtView | OpaqueView;

export interface VpTokenEntry {
 /** The DCQL credential query id this presentation answered. */
 queryId: string;
 presentations: PresentationView[];
}

export type VpTokenView = { ok: true; entries: VpTokenEntry[] } | DecodeFailure;

/**
 * Whether a presentation looks like an SD-JWT VC rather than an mdoc.
 *
 * The test is structural, never a claim about content: the part before the
 * first `~` must be a three-segment token whose header decodes to JSON. An
 * `mso_mdoc` presentation is base64url CBOR with no dots, so it fails this and
 * is shown opaque — which is the honest rendering. Guessing at CBOR would print
 * convincing nonsense, and this repo decodes for display only.
 */
function readPresentation(value: string): PresentationView {
 const parts = value.split("~");
 const issuerJwt = decodeJwsCompact(parts[0] ?? "");
 if (!issuerJwt.ok) return { kind: "opaque", value };

 const rest = parts.slice(1);
 // A TRAILING tilde means "no key binding": the final element is empty, not a
 // JWT. Treating it as one is the classic SD-JWT parsing bug.
 const hasKb = rest.length > 0 && rest[rest.length - 1] !== "";
 const kbSegment = hasKb ? rest[rest.length - 1]! : null;
 const disclosureSegments = rest.length > 0 ? rest.slice(0, -1) : [];

 return {
  kind: "sd-jwt",
  issuerJwt,
  disclosures: disclosureSegments.map((segment) => decodeSegment(segment)),
  kbJwt: kbSegment === null ? null : decodeJwsCompact(kbSegment),
 };
}

/**
 * Reads a `vp_token` into per-credential views.
 *
 * OpenID4VP 1.0 makes `vp_token` a JSON object keyed by DCQL credential query
 * id whose values are ARRAYS of presentations. Entries are never merged: two
 * credentials disclosing the same claim name would collide, which foundry's own
 * schema calls a correctness bug rather than a presentation choice.
 */
export function decodeVpToken(value: unknown): VpTokenView {
 if (typeof value !== "object" || value === null || Array.isArray(value)) {
  return { ok: false, reason: "vp_token must be an object keyed by query id" };
 }

 const entries: VpTokenEntry[] = [];
 for (const [queryId, raw] of Object.entries(value as Record<string, unknown>)) {
  if (!Array.isArray(raw)) {
   return { ok: false, reason: `vp_token['${queryId}'] must be an array` };
  }
  entries.push({
   queryId,
   presentations: raw.map((item) =>
    typeof item === "string"
     ? readPresentation(item)
     : { kind: "opaque" as const, value: String(item) },
   ),
  });
 }

 return { ok: true, entries };
}