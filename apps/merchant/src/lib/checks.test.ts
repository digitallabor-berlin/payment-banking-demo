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

const cardOk = {
  query_id: "sparkassencard",
  format: "dc+sd-jwt",
  claims: {
    sub: "urn:uuid:9f1c",
    masked_iban: "DE** **** 1234",
    psu_id: "5f0e6d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6",
  },
  checks: [
    { check: "dcql_match", passed: true },
    { check: "transaction_data_binding", passed: true },
  ],
};

const avMdocOk = {
  query_id: "av_mdoc",
  format: "mso_mdoc",
  claims: { "eu.europa.ec.av.1": { age_over_18: true } },
  checks: [{ check: "dcql_match", passed: true }],
};

const avSdJwtOk = {
  query_id: "av_sdjwt",
  format: "dc+sd-jwt",
  claims: { age_over_18: true },
  checks: [{ check: "dcql_match", passed: true }],
};

describe("passedTransactionDataBinding", () => {
  it("is true when the dpc credential reports the binding as passed", () => {
    expect(passedTransactionDataBinding(credentials(dpcOk))).toBe(true);
  });

  it("is true when a sparkassencard reports the binding as passed", () => {
    // `payment`/`payment_av` accept either payment type via `credential_sets`,
    // so a wallet holding only the Sparkassen Card answers with this query id
    // and nothing named `dpc` appears in the verdict at all.
    expect(passedTransactionDataBinding(credentials(cardOk))).toBe(true);
  });

  it("finds the binding on the payment credential even when an age credential is present", () => {
    // Under payment_av the verdict carries two entries; the money is bound to
    // the card, so the binding check lives on the payment credential only.
    expect(passedTransactionDataBinding(credentials(dpcOk, avMdocOk))).toBe(
      true,
    );
    expect(passedTransactionDataBinding(credentials(cardOk, avSdJwtOk))).toBe(
      true,
    );
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

  it("ignores a binding check reported on an age credential", () => {
    // Reading the first passing check anywhere in the verdict would let an
    // unrelated credential vouch for the payment amount.
    expect(
      passedTransactionDataBinding(
        credentials(
          { ...dpcOk, checks: [{ check: "dcql_match", passed: true }] },
          {
            ...avMdocOk,
            checks: [{ check: "transaction_data_binding", passed: true }],
          },
        ),
      ),
    ).toBe(false);
  });

  it("does not fall back to a second payment credential when the first one's binding failed", () => {
    // The load-bearing invariant: exactly ONE payment credential is resolved,
    // by a fixed preference order, and both the binding check and the join key
    // are read off that same entry. Searching on for any payment credential
    // with a passing binding would let the amount be bound to one card while
    // the debit is keyed to another.
    expect(
      passedTransactionDataBinding(
        credentials(
          { ...dpcOk, checks: [{ check: "dcql_match", passed: true }] },
          cardOk,
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

  it("reads psu_id from a sparkassencard's own claims", () => {
    // The DPC spells the bank's join key `credential_id`; the Sparkassen Card
    // spells it `psu_id`. Both land in the bank's one `credential_id` column,
    // so this returns the same kind of value either way.
    expect(extractCredentialId(credentials(cardOk))).toBe(
      "5f0e6d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6",
    );
  });

  it("reads it when an age credential is also present", () => {
    expect(extractCredentialId(credentials(dpcOk, avMdocOk))).toBe("dpc_abc");
    expect(extractCredentialId(credentials(cardOk, avSdJwtOk))).toBe(
      "5f0e6d1a-2b3c-4d5e-8f90-a1b2c3d4e5f6",
    );
  });

  it("resolves the same payment credential the binding gate does", () => {
    // Both functions must agree on which credential authorized the payment.
    // `dpc` wins when a wallet answers both payment options, so the id comes
    // from the DPC and not from the sparkassencard sitting beside it.
    expect(extractCredentialId(credentials(cardOk, dpcOk))).toBe("dpc_abc");
  });

  it("never takes a credential_id from an age credential", () => {
    // Claims are per credential and must never be merged: foundry's own schema
    // docs call merging a correctness bug, not a presentation choice.
    expect(
      extractCredentialId(
        credentials(
          { ...dpcOk, claims: { network: "girocard" } },
          { ...avMdocOk, claims: { credential_id: "not_the_card" } },
        ),
      ),
    ).toBeNull();
  });

  it("reads only the claim its own format declares, never the other one's", () => {
    // Not a fallback chain. A DPC that disclosed no `credential_id` must fail
    // closed rather than reach for a `psu_id` its vct does not declare, and
    // vice versa — otherwise a claim name collision decides who gets debited.
    expect(
      extractCredentialId(
        credentials({ ...dpcOk, claims: { psu_id: "wrong-key" } }),
      ),
    ).toBeNull();
    expect(
      extractCredentialId(
        credentials({ ...cardOk, claims: { credential_id: "wrong-key" } }),
      ),
    ).toBeNull();
  });

  it("returns null when no join key is present", () => {
    expect(
      extractCredentialId(
        credentials({ ...dpcOk, claims: { network: "girocard" } }),
      ),
    ).toBeNull();
    expect(extractCredentialId([])).toBeNull();
    expect(extractCredentialId(null)).toBeNull();
  });

  it("returns null for a non-string join key rather than coercing", () => {
    expect(
      extractCredentialId(
        credentials({ ...dpcOk, claims: { credential_id: 42 } }),
      ),
    ).toBeNull();
    expect(
      extractCredentialId(credentials({ ...cardOk, claims: { psu_id: 42 } })),
    ).toBeNull();
  });
});

describe("passedAgeVerification", () => {
  it("is true when the mdoc Proof of Age discloses age_over_18 as true", () => {
    expect(passedAgeVerification(credentials(dpcOk, avMdocOk))).toBe(true);
  });

  it("is true when the SD-JWT VC Proof of Age discloses age_over_18 as true", () => {
    // `payment_av`'s second credential_set accepts either format, so the gate
    // must too. A wallet holding only the SD-JWT variant satisfies the set.
    expect(passedAgeVerification(credentials(dpcOk, avSdJwtOk))).toBe(true);
  });

  it("reads the mdoc's age_over_18 from under the eu.europa.ec.av.1 namespace", () => {
    // An mdoc DCQL claim path is [namespace, element], and foundry nests the
    // disclosed elements under the namespace verbatim (verify.rs, the
    // `disclosed_claims.insert(ns, ...)` loop). A flat lookup finds nothing.
    expect(
      passedAgeVerification(
        credentials(dpcOk, { ...avMdocOk, claims: { age_over_18: true } }),
      ),
    ).toBe(false);
  });

  it("reads the SD-JWT VC's age_over_18 flat, not under a namespace", () => {
    // dc+sd-jwt disclosures land at the top level of that credential's own
    // claims object — the same shape the DPC's claims arrive in. There is no
    // namespace to nest under.
    expect(
      passedAgeVerification(
        credentials(dpcOk, {
          ...avSdJwtOk,
          claims: { "eu.europa.ec.av.1": { age_over_18: true } },
        }),
      ),
    ).toBe(false);
  });

  it("is false when the holder is not old enough, in either format", () => {
    expect(
      passedAgeVerification(
        credentials(dpcOk, {
          ...avMdocOk,
          claims: { "eu.europa.ec.av.1": { age_over_18: false } },
        }),
      ),
    ).toBe(false);
    expect(
      passedAgeVerification(
        credentials(dpcOk, { ...avSdJwtOk, claims: { age_over_18: false } }),
      ),
    ).toBe(false);
  });

  it("is false when no age credential was answered at all", () => {
    // Requesting an age attestation and settling without one is theatre. A
    // wallet that returns only the card must not clear this gate.
    expect(passedAgeVerification(credentials(dpcOk))).toBe(false);
    expect(passedAgeVerification(credentials(cardOk))).toBe(false);
  });

  it("ignores the pre-`payment_av` `av` query id", () => {
    // `dpc_av` named its age credential `av`; `payment_av` names the two
    // format options `av_sdjwt` and `av_mdoc`. Nothing answers `av` any more,
    // and a stored verdict from the old query must not clear the new gate.
    expect(
      passedAgeVerification(
        credentials(dpcOk, { ...avMdocOk, query_id: "av" }),
      ),
    ).toBe(false);
  });

  it("does not coerce a truthy non-boolean, in either format", () => {
    expect(
      passedAgeVerification(
        credentials({
          ...avMdocOk,
          claims: { "eu.europa.ec.av.1": { age_over_18: "yes" } },
        }),
      ),
    ).toBe(false);
    expect(
      passedAgeVerification(
        credentials({ ...avSdJwtOk, claims: { age_over_18: "yes" } }),
      ),
    ).toBe(false);
  });

  it("is false for an empty list, null, or a non-array", () => {
    expect(passedAgeVerification([])).toBe(false);
    expect(passedAgeVerification(null)).toBe(false);
    expect(passedAgeVerification("nope")).toBe(false);
  });
});
