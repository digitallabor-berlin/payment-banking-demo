import { describe, expect, it } from "vitest";
import type { PresentedCredential } from "@demo/foundry-client";
import { extractAuthSubject, findAuthenticatorCredential } from "./login-checks.js";

function credential(queryId: string, claims: unknown): PresentedCredential {
  return { query_id: queryId, format: "dc+sd-jwt", claims, checks: [] };
}

describe("findAuthenticatorCredential", () => {
  it("returns null for undefined", () => {
    expect(findAuthenticatorCredential(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(findAuthenticatorCredential([])).toBeNull();
  });

  it("finds the credential whose query_id is sparkassen_auth", () => {
    const target = credential("sparkassen_auth", { sub: "s1" });
    expect(findAuthenticatorCredential([target])).toBe(target);
  });

  it("ignores a credential that merely carries a sub claim", () => {
    // sparkassencard and wero both declare `sub`. Keying on the claim name
    // rather than the query id would let a payment credential authenticate.
    expect(
      findAuthenticatorCredential([credential("sparkassencard", { sub: "s1" })]),
    ).toBeNull();
    expect(
      findAuthenticatorCredential([credential("wero", { sub: "s1" })]),
    ).toBeNull();
  });

  it("picks the authenticator out of a mixed verdict", () => {
    const target = credential("sparkassen_auth", { sub: "right" });
    const found = findAuthenticatorCredential([
      credential("wero", { sub: "wrong" }),
      target,
      credential("av_sdjwt", { age_over_18: true }),
    ]);
    expect(found).toBe(target);
  });
});

describe("extractAuthSubject", () => {
  it("returns the sub of the authenticator credential", () => {
    expect(
      extractAuthSubject([credential("sparkassen_auth", { sub: "abc" })]),
    ).toBe("abc");
  });

  it("returns null when no authenticator credential answered", () => {
    expect(extractAuthSubject([credential("wero", { sub: "abc" })])).toBeNull();
  });

  it("returns null for a missing sub", () => {
    expect(extractAuthSubject([credential("sparkassen_auth", {})])).toBeNull();
  });

  it("returns null for an empty sub", () => {
    expect(
      extractAuthSubject([credential("sparkassen_auth", { sub: "" })]),
    ).toBeNull();
  });

  it("returns null for a non-string sub", () => {
    expect(
      extractAuthSubject([credential("sparkassen_auth", { sub: 42 })]),
    ).toBeNull();
  });

  it("returns null when claims is not an object", () => {
    expect(extractAuthSubject([credential("sparkassen_auth", null)])).toBeNull();
    expect(
      extractAuthSubject([credential("sparkassen_auth", "nope")]),
    ).toBeNull();
  });

  it("never reads a sub from a neighbouring payment credential", () => {
    expect(
      extractAuthSubject([
        credential("sparkassencard", { sub: "payment-subject" }),
        credential("sparkassen_auth", {}),
      ]),
    ).toBeNull();
  });
});