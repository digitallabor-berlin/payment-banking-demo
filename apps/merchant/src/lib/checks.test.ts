import { describe, expect, it } from "vitest";
import { extractCredentialId, passedTransactionDataBinding } from "./checks.js";

describe("passedTransactionDataBinding", () => {
  it("is true when the named check is present and passed", () => {
    expect(
      passedTransactionDataBinding([
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: true },
      ]),
    ).toBe(true);
  });

  it("is false when the named check failed", () => {
    expect(
      passedTransactionDataBinding([
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: false },
      ]),
    ).toBe(false);
  });

  it("is false when the check is absent entirely — the whole point of the gate", () => {
    // A foundry that silently stopped enforcing amount binding would report
    // every other check as passing. Absence must never read as success.
    expect(passedTransactionDataBinding([{ check: "dcql_match", passed: true }])).toBe(false);
  });

  it("is false for an empty list, null, or a non-array", () => {
    expect(passedTransactionDataBinding([])).toBe(false);
    expect(passedTransactionDataBinding(null)).toBe(false);
    expect(passedTransactionDataBinding("nope")).toBe(false);
    expect(passedTransactionDataBinding({ check: "transaction_data_binding" })).toBe(false);
  });
});

describe("extractCredentialId", () => {
  it("reads a credential_id nested under the DCQL query id", () => {
    expect(extractCredentialId({ card: { credential_id: "dpc_abc", network: "VISA" } })).toBe(
      "dpc_abc",
    );
  });

  it("reads a flat credential_id", () => {
    expect(extractCredentialId({ credential_id: "dpc_abc" })).toBe("dpc_abc");
  });

  it("returns null when no credential_id is present", () => {
    expect(extractCredentialId({ card: { network: "VISA" } })).toBeNull();
    expect(extractCredentialId({})).toBeNull();
    expect(extractCredentialId(null)).toBeNull();
  });

  it("returns null for a non-string credential_id rather than coercing", () => {
    expect(extractCredentialId({ credential_id: 42 })).toBeNull();
  });
});