/**
 * Which OpenID4VP transport to ask foundry for. Extracted from the component
 * so vitest covers it — every project here is `environment: "node"` with
 * `include: ["src/**\/*.test.ts"]`, so a ternary in a `.tsx` file is untested.
 *
 * `null` means detection has not resolved yet (see `useDcApiSupport`), which is
 * NOT the same as "unsupported". The QR transport is the safe default: it works
 * in every browser.
 *
 * A deliberate twin of the merchant's `selectTransport` rather than a shared
 * export. `@demo/ui` holds behaviour with no app-specific meaning, the
 * merchant's copy is already tested where it lives, and a shared one-line
 * function across two apps is a coupling with no payoff.
 */
export function selectTransport(
  dcApiSupported: boolean | null,
): "dc_api" | "request_uri" {
  return dcApiSupported === true ? "dc_api" : "request_uri";
}