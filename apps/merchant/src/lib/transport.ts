/**
 * Which OpenID4VP transport to ask foundry for. Extracted from the component
 * so it is covered by vitest, which only matches `src/**` `/*.test.ts`.
 *
 * `null` means detection has not resolved yet (see useDcApiSupport). The QR
 * transport is the safe default: it works in every browser.
 */
export function selectTransport(dcApiSupported: boolean | null): "dc_api" | "request_uri" {
  return dcApiSupported === true ? "dc_api" : "request_uri";
}