import { describe, expect, it } from "vitest";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_QUERY_ID,
} from "./credential-types.js";
import {
  buildTransferAdHocMetadataRequest,
  buildTransferTransactionData,
  TRANSFER_METADATA_TTL_SECS,
  TRANSFER_TRANSACTION_DATA_TYPE,
  type TransferAdHocMetadata,
} from "./transfer-transaction-data.js";

const JWT = "header.payload.signature";

/** The four values a holder types, already normalised by Task 3's validator. */
const INPUT = {
  payeeName: "Max Mustermann",
  payeeIban: "DE89370400440532013000",
  amountCents: 25_000,
  purpose: "Rent October",
  metadataJwt: JWT,
};

interface Entry {
  type: string;
  credential_ids: string[];
  transaction_data_hashes_alg: string[];
  payload: Record<string, string>;
  metadata: string;
}

function entryOf(over: Partial<typeof INPUT> = {}): Entry {
  const built = buildTransferTransactionData({ ...INPUT, ...over });
  expect(built).toHaveLength(1);
  return built[0] as Entry;
}

describe("buildTransferTransactionData", () => {
  it("sends one entry of the transfer type", () => {
    const entry = entryOf();
    expect(entry.type).toBe(TRANSFER_TRANSACTION_DATA_TYPE);
    expect(entry.type).toBe("urn:paso:sca:dev.digitallabor:transfer:1");
  });

  it("names the DCQL query id in credential_ids", () => {
    // The DCQL QUERY id, not the credential type constant. They share a
    // spelling and are deliberately separate constants — foundry validates
    // this list against the resolved named query and 400s on an unknown id.
    expect(entryOf().credential_ids).toEqual([SPARKASSEN_AUTH_QUERY_ID]);
  });

  it("states transaction_data_hashes_alg explicitly", () => {
    expect(entryOf().transaction_data_hashes_alg).toEqual(["sha-256"]);
  });

  it("carries exactly the four payload claims", () => {
    expect(Object.keys(entryOf().payload).sort()).toEqual([
      "amount",
      "payee_iban",
      "payee_name",
      "purpose",
    ]);
  });

  it("formats the amount as amount-first", () => {
    expect(entryOf().payload.amount).toBe("250.00 EUR");
  });

  it("groups the IBAN in fours for a human to read", () => {
    // The whole point of the consent screen is that a holder can compare what
    // it shows against what they typed. The database stores the normalised
    // form; this is derived from it, so there is one source.
    expect(entryOf().payload.payee_iban).toBe("DE89 3704 0044 0532 0130 00");
  });

  it("passes the name and purpose through unchanged", () => {
    const payload = entryOf().payload;
    expect(payload.payee_name).toBe("Max Mustermann");
    expect(payload.purpose).toBe("Rent October");
  });

  it("carries the minted JWT verbatim in metadata", () => {
    expect(entryOf().metadata).toBe(JWT);
  });

  it("survives JSON.stringify with metadata intact", () => {
    // `JSON.stringify` silently DROPS an undefined member, and foundry accepts
    // an entry with no `metadata` at HTTP 200 — so a dropped JWT is the
    // anti-goal shipping as a success.
    const entry = entryOf();
    expect(JSON.parse(JSON.stringify(entry)).metadata).toBe(JWT);
  });
});

describe("buildTransferAdHocMetadataRequest", () => {
  const request = buildTransferAdHocMetadataRequest();
  const metadata = request.metadata as TransferAdHocMetadata;

  function claimFor(path: string) {
    const claim = metadata.claims.find((c) => c.path[0] === path);
    expect(claim).toBeDefined();
    return claim!;
  }

  it("binds the override to the entry's own type", () => {
    expect(request.transaction_data_type).toBe(TRANSFER_TRANSACTION_DATA_TYPE);
  });

  it("names the authenticator credential type", () => {
    expect(request.credential_type_id).toBe(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID);
    expect(request.credential_type_id).toBe("sparkassen_auth");
  });

  it("asks for 900 seconds", () => {
    // foundry's default is 300 — EXACTLY the session TTL — and the JWT is
    // minted after the row is written, so inheriting it races.
    expect(request.ttl_secs).toBe(900);
    expect(request.ttl_secs).toBe(TRANSFER_METADATA_TTL_SECS);
  });

  it("declares exactly the four claims in consent order", () => {
    // Amount first: it is the number a defrauded person needs to notice. The
    // DIALOG's field order is entry order and is allowed to differ.
    expect(metadata.claims.map((c) => c.path[0])).toEqual([
      "amount",
      "payee_name",
      "payee_iban",
      "purpose",
    ]);
  });

  it("puts iso_currency_amount on amount and value_type on NOTHING else", () => {
    // PaSO View §3: a wallet SHALL EXCLUDE an entry whose declared value_type
    // it does not support. An invented type for the IBAN would therefore
    // refuse the whole presentation rather than degrade one label.
    expect(claimFor("amount").value_type).toBe("iso_currency_amount");
    for (const path of ["payee_name", "payee_iban", "purpose"]) {
      expect(claimFor(path)).not.toHaveProperty("value_type");
    }
  });

  it("uses BARE locale tags on every display array", () => {
    // `en-US`/`de-DE` broke every real presentation: RFC 4647 Lookup only
    // SHORTENS a user's range, so a region tag is strictly less reachable, and
    // PaSO View §4 is all-or-nothing.
    for (const claim of metadata.claims) {
      expect(claim.display.map((d) => d.locale)).toEqual(["en", "de"]);
    }
  });

  it("uses BARE locale tags on every ui_label", () => {
    for (const values of Object.values(metadata.ui_labels)) {
      expect(values.map((v) => v.locale)).toEqual(["en", "de"]);
    }
  });

  it("carries all four ui_labels", () => {
    expect(Object.keys(metadata.ui_labels).sort()).toEqual([
      "affirmative_action_label",
      "denial_action_label",
      "security_hint",
      "transaction_title",
    ]);
  });

  it("warns about transfers to a new account in both locales", () => {
    // PaSO §3.2 requires the wallet to display this verbatim and forbids
    // altering or removing it. Authorised push payment fraud IS this screen.
    const hint = metadata.ui_labels.security_hint!;
    expect(hint.find((v) => v.locale === "en")?.value).toBe(
      "Sparkasse will never ask you to transfer money to a new account.",
    );
    expect(hint.find((v) => v.locale === "de")?.value).toBe(
      "Die Sparkasse wird Sie niemals bitten, Geld auf ein neues Konto zu überweisen.",
    );
  });

  it("names the transfer in both locales on every label", () => {
    for (const values of Object.values(metadata.ui_labels)) {
      expect(values).toHaveLength(2);
      for (const { value } of values) expect(value.length).toBeGreaterThan(0);
    }
  });

  it("gives every claim a display name in both locales", () => {
    for (const claim of metadata.claims) {
      expect(claim.display).toHaveLength(2);
      for (const { name } of claim.display) {
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });

  it("marks every claim mandatory", () => {
    for (const claim of metadata.claims) expect(claim.mandatory).toBe(true);
  });
});