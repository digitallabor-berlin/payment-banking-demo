import { describe, expect, it } from "vitest";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_QUERY_ID,
} from "./credential-types.js";
import {
  buildLimitChangeAdHocMetadataRequest,
  buildLimitChangeTransactionData,
  LIMIT_CHANGE_METADATA_TTL_SECS,
  LIMIT_CHANGE_TRANSACTION_DATA_TYPE,
  limitAmountString,
  type LimitChangeAdHocMetadata,
} from "./limit-transaction-data.js";

/**
 * `AdHocMetadataRequest.metadata` is deliberately `unknown` on the client —
 * foundry validates a shape that package must not re-declare. The bank DOES
 * own that shape, so it exports a named type and the test narrows through it
 * rather than through `as any`.
 */
function metadataOf(): LimitChangeAdHocMetadata {
  return buildLimitChangeAdHocMetadataRequest()
    .metadata as LimitChangeAdHocMetadata;
}

/** One entry, narrowed once. `buildLimitChangeTransactionData` returns `unknown[]`. */
function entryOf(
  oldLimitCents = 100_000,
  newLimitCents = 200_000,
  metadataJwt = "a.b.c",
) {
  const entries = buildLimitChangeTransactionData({
    oldLimitCents,
    newLimitCents,
    metadataJwt,
  });
  return entries[0] as {
    type: string;
    credential_ids: string[];
    transaction_data_hashes_alg: string[];
    payload: Record<string, string>;
    metadata: string;
  };
}

describe("LIMIT_CHANGE_TRANSACTION_DATA_TYPE", () => {
  it("names the limit-change type", () => {
    expect(LIMIT_CHANGE_TRANSACTION_DATA_TYPE).toBe(
      "urn:paso:sca:dev.digitallabor:limit-change:1",
    );
  });

  it("follows PaSO Core 5.2's urn form and reuses the login type's domain", () => {
    expect(LIMIT_CHANGE_TRANSACTION_DATA_TYPE).toMatch(
      /^urn:paso:sca:dev\.digitallabor:[^:]+:\d+$/,
    );
  });
});

describe("limitAmountString", () => {
  it.each([
    [100_000, "EUR 1000.00"],
    [200_000, "EUR 2000.00"],
    [50_000, "EUR 500.00"],
    [500_000, "EUR 5000.00"],
    [99, "EUR 0.99"],
    [0, "EUR 0.00"],
  ])("formats %i cents as %s", (cents, expected) => {
    expect(limitAmountString(cents)).toBe(expected);
  });

  it("never localises the amount", () => {
    // No thousands separator, no comma decimal. The string is hashed
    // byte-for-byte into transaction_data_hashes, so an Intl-formatted value
    // would make the signed artefact depend on the browser's locale.
    expect(limitAmountString(1_234_567)).toBe("EUR 12345.67");
    expect(limitAmountString(1_234_567)).not.toContain(",");
    expect(limitAmountString(1_234_567)).not.toContain("\u00a0");
  });

  it("always carries exactly two decimal places", () => {
    for (const cents of [1, 10, 100, 1_000, 10_000]) {
      expect(limitAmountString(cents)).toMatch(/^EUR \d+\.\d{2}$/);
    }
  });
});

describe("buildLimitChangeTransactionData", () => {
  it("sends one entry", () => {
    expect(
      buildLimitChangeTransactionData({
        oldLimitCents: 100_000,
        newLimitCents: 200_000,
        metadataJwt: "a.b.c",
      }),
    ).toHaveLength(1);
  });

  it("binds to the authenticator query and nothing else", () => {
    expect(entryOf().credential_ids).toEqual([SPARKASSEN_AUTH_QUERY_ID]);
  });

  it("states the hash algorithm explicitly", () => {
    expect(entryOf().transaction_data_hashes_alg).toEqual(["sha-256"]);
  });

  it("carries exactly old_limit and new_limit", () => {
    expect(entryOf().payload).toEqual({
      old_limit: "EUR 1000.00",
      new_limit: "EUR 2000.00",
    });
  });

  it("names the limit-change type on the entry", () => {
    expect(entryOf().type).toBe(LIMIT_CHANGE_TRANSACTION_DATA_TYPE);
  });

  it("carries the minted JWT verbatim in `metadata`", () => {
    expect(entryOf(100_000, 200_000, "a.b.c").metadata).toBe("a.b.c");
  });

  it("re-encodes nothing — foundry does the 8.4 base64url itself", () => {
    const jwt = "eyJ0eXAiOiJhZGhvYy1qd3QifQ.eyJzdWIiOiJ4In0.sig";
    expect(entryOf(100_000, 200_000, jwt).metadata).toBe(jwt);
  });

  it("has exactly the five members the entry declares", () => {
    expect(Object.keys(entryOf()).sort()).toEqual([
      "credential_ids",
      "metadata",
      "payload",
      "transaction_data_hashes_alg",
      "type",
    ]);
  });
});

describe("buildLimitChangeAdHocMetadataRequest", () => {
  it("mints against the authenticator credential type for this type id", () => {
    const req = buildLimitChangeAdHocMetadataRequest();
    expect(req.credential_type_id).toBe(SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID);
    expect(req.transaction_data_type).toBe(LIMIT_CHANGE_TRANSACTION_DATA_TYPE);
    expect(req.ttl_secs).toBe(900);
    expect(LIMIT_CHANGE_METADATA_TTL_SECS).toBe(900);
  });

  it("takes no arguments — nothing in the metadata varies per request", () => {
    expect(buildLimitChangeAdHocMetadataRequest.length).toBe(0);
    expect(buildLimitChangeAdHocMetadataRequest()).toEqual(
      buildLimitChangeAdHocMetadataRequest(),
    );
  });

  it("describes both claims with region-tagged locales and a currency value type", () => {
    const metadata = metadataOf();
    expect(metadata.claims.map((claim) => claim.path.join("."))).toEqual([
      "old_limit",
      "new_limit",
    ]);
    for (const claim of metadata.claims) {
      expect(claim.mandatory).toBe(true);
      expect(claim.value_type).toBe("iso_currency_amount");
      expect(claim.display.map((d) => d.locale)).toEqual(["en-US", "de-DE"]);
    }
  });

  it("uses the consent screen's claim names verbatim", () => {
    const metadata = metadataOf();
    expect(metadata.claims[0]?.display).toEqual([
      { locale: "en-US", name: "Current Account Limit" },
      { locale: "de-DE", name: "Aktuelles Kontolimit" },
    ]);
    expect(metadata.claims[1]?.display).toEqual([
      { locale: "en-US", name: "New Account Limit" },
      { locale: "de-DE", name: "Neues Kontolimit" },
    ]);
  });

  it("supplies the consent screen's title, both actions and the security hint", () => {
    expect(Object.keys(metadataOf().ui_labels).sort()).toEqual([
      "affirmative_action_label",
      "denial_action_label",
      "security_hint",
      "transaction_title",
    ]);
  });

  it("uses the exact affirmative action the design fixes", () => {
    expect(metadataOf().ui_labels.affirmative_action_label).toEqual([
      { locale: "en-US", value: "Confirm Limit Change" },
      { locale: "de-DE", value: "Limitänderung bestätigen" },
    ]);
  });

  it("warns that the bank never asks for a raise", () => {
    // The wallet must display security_hint verbatim and may not alter or
    // remove it (PaSO 3.2) — which is the point: raising a transfer limit is a
    // standard step in an authorised push payment scam, and the bank's warning
    // must survive whatever is driving the browser.
    expect(metadataOf().ui_labels.security_hint).toEqual([
      {
        locale: "en-US",
        value: "Sparkasse will never ask you to raise your limit.",
      },
      {
        locale: "de-DE",
        value: "Die Sparkasse wird Sie niemals bitten, Ihr Limit zu erhöhen.",
      },
    ]);
  });

  it("sends both locales on every label, never just the bank's current one", () => {
    // The wallet picks by its OWN locale priority list, which the bank cannot
    // observe. PaSO 5.4 lets a wallet treat an entry with no compatible locale
    // as incompatible, so this is correctness rather than polish.
    for (const label of Object.values(metadataOf().ui_labels)) {
      expect(label.map((entry) => entry.locale)).toEqual(["en-US", "de-DE"]);
    }
  });

  it("never uses this app's own locale tags", () => {
    // This app's Locale is `en` / `de`; the JWT's tags are `en-US` / `de-DE`,
    // matching every tag the deployed foundry publishes. A wallet doing
    // RFC4647 lookup degrades de-DE to de but need not promote de to de-DE.
    expect(JSON.stringify(metadataOf())).not.toMatch(/"locale":"(en|de)"/);
  });

  it("keeps every label inside PaSO 3.3's grapheme limits", () => {
    // foundry enforces these at mint time and returns 400, so an over-long
    // German string is a build-time failure rather than a silent truncation.
    const metadata = metadataOf();
    for (const claim of metadata.claims) {
      for (const display of claim.display) {
        expect(display.name.length).toBeLessThanOrEqual(60);
      }
    }
    const max: Record<string, number> = {
      transaction_title: 100,
      affirmative_action_label: 40,
      denial_action_label: 40,
      security_hint: 100,
    };
    for (const [key, label] of Object.entries(metadata.ui_labels)) {
      for (const entry of label) {
        expect(entry.value.length).toBeLessThanOrEqual(max[key]!);
      }
    }
  });
});