import { describe, expect, it } from "vitest";
import {
  extractCredentialId,
  passedAgeVerification,
  passedTransactionDataBinding,
} from "./checks.js";

/** A verdict shaped the way foundry actually serves it. */
function credentials(...entries: unknown[]): unknown {
  return entries;
}

const dpcOk = {
  query_id: "dpc",
  format: "dc+sd-jwt",
  claims: { credential_id: "dpc_abc", network: "girocard" },
  checks: [
    { check: "dcql_match", passed: true },
    { check: "transaction_data_binding", passed: true },
  ],
};

const avOk = {
  query_id: "av",
  format: "mso_mdoc",
  claims: { "eu.europa.ec.av.1": { age_over_18: true } },
  checks: [{ check: "dcql_match", passed: true }],
};

describe("passedTransactionDataBinding", () => {
  it("is true when the dpc credential reports the binding as passed", () => {
    expect(passedTransactionDataBinding(credentials(dpcOk))).toBe(true);
  });

  it("finds the binding on the dpc credential even when an av credential is present", () => {
    // Under dpc_av the verdict carries two entries; the money is bound to the
    // card, so the binding check lives on `dpc` and nowhere else.
    expect(passedTransactionDataBinding(credentials(dpcOk, avOk))).toBe(true);
  });

  it("is false when the binding check failed", () => {
    expect(
      passedTransactionDataBinding(
        credentials({
          ...dpcOk,
          checks: [{ check: "transaction_data_binding", passed: false }],
        }),
      ),
    ).toBe(false);
  });

  it("is false when the check is absent entirely — the whole point of the gate", () => {
    // A foundry that silently stopped enforcing amount binding would report
    // every other check as passing. Absence must never read as success.
    expect(
      passedTransactionDataBinding(
        credentials({
          ...dpcOk,
          checks: [{ check: "dcql_match", passed: true }],
        }),
      ),
    ).toBe(false);
  });

  it("ignores a binding check reported on a credential other than dpc", () => {
    // Reading the first passing check anywhere in the verdict would let an
    // unrelated credential vouch for the payment amount.
    expect(
      passedTransactionDataBinding(
        credentials(
          { ...dpcOk, checks: [{ check: "dcql_match", passed: true }] },
          {
            ...avOk,
            checks: [{ check: "transaction_data_binding", passed: true }],
          },
        ),
      ),
    ).toBe(false);
  });

  it("is false for an empty list, null, or a non-array", () => {
    expect(passedTransactionDataBinding([])).toBe(false);
    expect(passedTransactionDataBinding(null)).toBe(false);
    expect(passedTransactionDataBinding("nope")).toBe(false);
    expect(passedTransactionDataBinding({ query_id: "dpc" })).toBe(false);
  });
});

describe("extractCredentialId", () => {
  it("reads credential_id from the dpc credential's own claims", () => {
    expect(extractCredentialId(credentials(dpcOk))).toBe("dpc_abc");
  });

  it("reads it when an av credential is also present", () => {
    expect(extractCredentialId(credentials(dpcOk, avOk))).toBe("dpc_abc");
  });

  it("never takes a credential_id from a credential other than dpc", () => {
    // Claims are per credential and must never be merged: foundry's own schema
    // docs call merging a correctness bug, not a presentation choice.
    expect(
      extractCredentialId(
        credentials(
          { ...dpcOk, claims: { network: "girocard" } },
          { ...avOk, claims: { credential_id: "not_the_card" } },
        ),
      ),
    ).toBeNull();
  });

  it("returns null when no credential_id is present", () => {
    expect(
      extractCredentialId(
        credentials({ ...dpcOk, claims: { network: "girocard" } }),
      ),
    ).toBeNull();
    expect(extractCredentialId([])).toBeNull();
    expect(extractCredentialId(null)).toBeNull();
  });

  it("returns null for a non-string credential_id rather than coercing", () => {
    expect(
      extractCredentialId(
        credentials({ ...dpcOk, claims: { credential_id: 42 } }),
      ),
    ).toBeNull();
  });
});

describe("passedAgeVerification", () => {
  it("is true when the av credential discloses age_over_18 as true", () => {
    expect(passedAgeVerification(credentials(dpcOk, avOk))).toBe(true);
  });

  it("reads age_over_18 from under the eu.europa.ec.av.1 namespace", () => {
    // An mdoc DCQL claim path is [namespace, element], and foundry nests the
    // disclosed elements under the namespace verbatim (verify.rs, the
    // `disclosed_claims.insert(ns, ...)` loop). A flat lookup finds nothing.
    expect(
      passedAgeVerification(
        credentials(dpcOk, { ...avOk, claims: { age_over_18: true } }),
      ),
    ).toBe(false);
  });

  it("is false when the holder is not old enough", () => {
    expect(
      passedAgeVerification(
        credentials(dpcOk, {
          ...avOk,
          claims: { "eu.europa.ec.av.1": { age_over_18: false } },
        }),
      ),
    ).toBe(false);
  });

  it("is false when the av credential was not answered at all", () => {
    // Requesting an age attestation and settling without one is theatre. A
    // wallet that returns only the card must not clear this gate.
    expect(passedAgeVerification(credentials(dpcOk))).toBe(false);
  });

  it("does not coerce a truthy non-boolean", () => {
    expect(
      passedAgeVerification(
        credentials({
          ...avOk,
          claims: { "eu.europa.ec.av.1": { age_over_18: "yes" } },
        }),
      ),
    ).toBe(false);
  });

  it("is false for an empty list, null, or a non-array", () => {
    expect(passedAgeVerification([])).toBe(false);
    expect(passedAgeVerification(null)).toBe(false);
    expect(passedAgeVerification("nope")).toBe(false);
  });
});
