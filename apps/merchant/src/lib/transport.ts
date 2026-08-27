/**
 * Which OpenID4VP transport to ask foundry for. Extracted from the component
 * so it is covered by vitest, which only matches `src/**` `/*.test.ts`.
 *
 * There are three, not two, because the two W3C Digital Credentials API forms
 * produce genuinely different wire artifacts: `dc_api` inlines a bare unsigned
 * parameter object, `dc_api_signed` inlines a Request Object signed as a JWS
 * Compact Serialization (OpenID4VP 1.0 §A.2), which the wallet authenticates
 * from the signature and its `x5c` chain rather than from the browser's web PKI
 * and platform-supplied Origin alone.
 */
export type PresentationTransport = "request_uri" | "dc_api" | "dc_api_signed";

/** Which DC API wire form to ask for. Signed is the default. */
export type DcApiForm = "signed" | "unsigned";

/** The query param that opts out of the signed default: `?dcapi=unsigned`. */
export const DC_API_FORM_PARAM = "dcapi";

/**
 * Reads the `?dcapi=` opt-out. Signed is the default, so ONLY the exact value
 * `unsigned` selects the unsigned form — an absent param, an empty one and a
 * typo all mean signed. Failing an unrecognised value closed would let
 * `?dcapi=unsinged` silently downgrade the wire form, which is the opposite of
 * what a debugging affordance should do.
 *
 * Lives here rather than in the component because vitest runs
 * `environment: "node"` with `include: ["src/**` `/*.test.ts"]`, so a decision
 * taken inside a `.tsx` file is never covered.
 */
export function parseDcApiForm(raw: string | null | undefined): DcApiForm {
 return raw?.trim().toLowerCase() === "unsigned" ? "unsigned" : "signed";
}

/**
 * `null` means detection has not resolved yet (see useDcApiSupport). The QR
 * transport is the safe default: it works in every browser.
 */
export function selectTransport(
 dcApiSupported: boolean | null,
 form: DcApiForm,
): PresentationTransport {
 if (dcApiSupported !== true) return "request_uri";
 return form === "unsigned" ? "dc_api" : "dc_api_signed";
}

/**
 * Mirrors foundry's `VerificationTransaction::is_dc_api`. Both DC API forms
 * inline their request object and return the wallet's response through the
 * relay; only `request_uri` yields a scannable URI.
 *
 * Every site that asks "is this a DC API session" must come through here. A
 * bare `transport === "dc_api"` does not match the signed value and would
 * silently render a QR for a session that has no URI at all — the same class of
 * bug foundry had to fix in its own verify path when it added this predicate.
 */
export function isDcApiTransport(transport: string): boolean {
 return transport === "dc_api" || transport === "dc_api_signed";
}

/**
 * Kept in sync with `DC_API_PRESENTATION_PROTOCOL` and
 * `DC_API_PRESENTATION_PROTOCOL_SIGNED` in `@demo/ui`, and repeated here rather
 * than imported because that package has only a `.` export whose barrel pulls
 * in React components and `qrcode`, while this module is imported by
 * server-side code. `transport.test.ts` asserts the two spellings agree.
 */
const UNSIGNED_PROTOCOL = "openid4vp-v1-unsigned";
const SIGNED_PROTOCOL = "openid4vp-v1-signed";

/**
 * The identifier to feature-detect against for a given wire form.
 *
 * Only used for detection: the identifier actually paired with a payload is the
 * one foundry returned on the session. On the one browser we can measure this
 * argument is inert anyway — HeadlessChrome 151's `userAgentAllowsProtocol`
 * answers `true` for every string, including a bogus one — but asking about the
 * form we intend to use is the honest wiring.
 */
export function presentationProtocolFor(form: DcApiForm): string {
 return form === "unsigned" ? UNSIGNED_PROTOCOL : SIGNED_PROTOCOL;
}

/**
 * Which DC API exchange protocol identifier to persist for a session, given the
 * transport that was requested and whatever `protocol` foundry returned.
 *
 * foundry's value always wins — it decides the request-object shape and this
 * identifier names that shape, so the two must travel together. The single
 * fallback is a compatibility shim for a foundry predating the field: such a
 * build knows only the unsigned DC API form (an unknown transport falls through
 * to `direct_post.jwt`), so for `dc_api` the omission is unambiguous. For
 * `dc_api_signed` it is not, and this returns null rather than guessing —
 * `startPaymentSession` then records the transport foundry actually served
 * instead of the one that was asked for.
 */
export function resolveDcApiProtocol(
 requested: PresentationTransport,
 returned: string | null | undefined,
): string | null {
 if (!isDcApiTransport(requested)) return null;
 if (returned) return returned;
 return requested === "dc_api" ? UNSIGNED_PROTOCOL : null;
}
