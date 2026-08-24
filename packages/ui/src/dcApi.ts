/**
 * W3C Digital Credentials API detection and invocation.
 *
 * Ported from two proven implementations that agree on everything except the
 * `create` gate: ../foundry/crates/foundry/assets/console.html and
 * ../eudipay-frontend/src/dcApi.js. See spec D4 for why `create` is lenient.
 *
 * Browser globals are INJECTED rather than read at module scope. That is what
 * makes this file testable under vitest's node environment, which has no
 * `window`.
 */

/** Chrome origin-trial identifier for DC API issuance. Not a pinned spec. */
export const DC_API_ISSUANCE_PROTOCOL = "openid4vci-v1";

/** OpenID4VP over the DC API, unsigned inline request object. */
export const DC_API_PRESENTATION_PROTOCOL = "openid4vp-v1-unsigned";

export type DcApiMethod = "get" | "create";

export interface DcApiGlobals {
 isSecureContext?: boolean;
 DigitalCredential?: {
  userAgentAllowsProtocol?: (protocol: string) => boolean;
 };
 navigator?: { credentials?: Record<string, unknown> };
}

export interface DcApiEnvelope {
 digital: { requests: Array<{ protocol: string; data: unknown }> };
}

/**
 * Feature detection only — never a probe call, never user-agent sniffing.
 * Actual capability is answered by invoking and catching the throw.
 */
export function supportsDcApi(
 method: DcApiMethod,
 protocol: string,
 // Every member of DcApiGlobals is optional and read defensively below, so a
 // `globalThis` missing all of them (vitest's node environment) narrows to
 // `false` rather than throwing.
 // The cast only supplies the default argument; it never asserts the browser
 // globals are actually present.
 globals: DcApiGlobals = globalThis as unknown as DcApiGlobals, // SAFETY: all members optional
): boolean {
 if (!globals || !globals.isSecureContext) return false;

 const dc = globals.DigitalCredential;
 if (!dc) return false;

 const credentials = globals.navigator?.credentials;
 if (!credentials) return false;
 if (typeof credentials[method] !== "function") return false;

 // Spec D4: `userAgentAllowsProtocol` is specified around presentation.
 // `openid4vci-v1` is a Chrome origin-trial identifier behind a flag, so a
 // browser that CAN issue may still answer false or throw for it. A false
 // negative would mean the feature silently never appears, which is worse
 // for this demo than a false positive costing one visible click.
 if (method === "create") return true;

 if (typeof dc.userAgentAllowsProtocol !== "function") return true;
 try {
  return Boolean(dc.userAgentAllowsProtocol(protocol));
 } catch {
  return false;
 }
}

/** Distinguishes "this browser cannot" from "this attempt failed". */
export function isDcApiNotSupportedError(error: unknown): boolean {
 const err = error as { name?: unknown; message?: unknown } | null | undefined;
 const name = typeof err?.name === "string" ? err.name : "";
 const message = typeof err?.message === "string" ? err.message : "";

 return (
  name === "NotSupportedError" ||
  (name === "TypeError" && /not supported/i.test(message)) ||
  /CredentialContainer/i.test(message)
 );
}

export function prepareDcApiRequest(
 data: unknown,
 protocol: string,
): DcApiEnvelope {
 return { digital: { requests: [{ protocol, data }] } };
}

/**
 * Presentation. MUST be reached with no `await` executed since the click
 * handler started — Chrome consumes transient activation otherwise.
 */
export async function invokeDcGet(
 req: DcApiEnvelope,
): Promise<{ response: string }> {
 const credentialResponse = await navigator.credentials.get(
  // SAFETY: `digital` is not in this TypeScript release's DOM lib, so the
  // envelope cannot be expressed as CredentialRequestOptions. The runtime
  // shape is the W3C one; a browser that does not know the member ignores it.
  req as unknown as CredentialRequestOptions,
 );
 if (
  !credentialResponse ||
  credentialResponse.constructor?.name !== "DigitalCredential"
 ) {
  throw new Error(
   "No DigitalCredential returned from navigator.credentials.get",
  );
 }
 // SAFETY: guarded by the constructor check above — only a real
 // DigitalCredential reaches here, and that interface carries `data`.
 return (credentialResponse as unknown as { data: { response: string } }).data;
}

/**
 * Issuance. Still NOT symmetric with invokeDcGet — no return-SHAPE assertion,
 * because Chrome's documented issuance example ignores create()'s return value
 * and demanding a `DigitalCredential` here would manufacture failures on a
 * successful handoff.
 *
 * But non-throw is NOT by itself the success signal, which is what it used to
 * be. Per Credential Management, create() resolves with `null` when options
 * carry no credential type the browser recognises. Safari 26 ships the DC API
 * for PRESENTATION only, so it has `DigitalCredential` and — via WebAuthn —
 * `navigator.credentials.create`, which is everything supportsDcApi's lenient
 * `create` gate inspects. The bank therefore renders the DC API button, and the
 * click resolved `null` (measured in Safari 26.5.2). Swallowing that made the
 * button a permanent silent no-op: no error, and never the QR fallback.
 *
 * A null/undefined check is strictly weaker than a shape assertion — it means
 * "nothing was created", which no successful handover can report — so the
 * Chrome contract above survives it. Raised as NotSupportedError so
 * isDcApiNotSupportedError routes it to the "this browser cannot" copy rather
 * than "you cancelled".
 *
 * Same transient-activation constraint as invokeDcGet.
 */
export async function invokeDcCreate(req: DcApiEnvelope): Promise<void> {
 const created = await navigator.credentials.create(
  // SAFETY: as in invokeDcGet — `digital` predates this DOM lib. Unknown to
  // the browser it is ignored, which is exactly the `null` resolution the
  // check below catches.
  req as unknown as CredentialCreationOptions,
 );
 if (created === null || created === undefined) {
  throw new DOMException(
   "navigator.credentials.create resolved without a credential; this browser does not implement Digital Credentials API issuance",
   "NotSupportedError",
  );
 }
}
