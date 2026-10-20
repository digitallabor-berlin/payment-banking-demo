import { describe, expect, it } from "vitest";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_QUERY_ID,
} from "./credential-types.js";
import {
  buildPhoneChangeAdHocMetadataRequest,
  buildPhoneChangeTransactionData,
  PHONE_CHANGE_METADATA_TTL_SECS,
  PHONE_CHANGE_TRANSACTION_DATA_TYPE,
  type PhoneChangeAdHocMetadata,
} from "./phone-transaction-data.js";

/**
 * `AdHocMetadataRequest.metadata` is deliberately `unknown` on the client —
 * foundry validates a shape that package must not re-declare. The bank DOES
 * own that shape, so it exports a named type and the test narrows through it
 * rather than through `as any`.
 */
function metadataOf(): PhoneChangeAdHocMetadata {
  return buildPhoneChangeAdHocMetadataRequest()
    .metadata as PhoneChangeAdHocMetadata;
}

/** One entry, narrowed once. `buildPhoneChangeTransactionData` returns `unknown[]`. */
function entryOf(
  oldPhone = "+49 171 5555555",
  newPhone = "+49 172 66666666",
  metadataJwt = "a.b.c",
) {
  const entries = buildPhoneChangeTransactionData({
    oldPhone,
    newPhone,
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

/** Every locale tag anywhere in the minted metadata. */
function allLocales(metadata: PhoneChangeAdHocMetadata): string[] {
  return [
    ...metadata.claims.flatMap((claim) =>
      claim.display.map((entry) => entry.locale),
    ),
    ...Object.values(metadata.ui_labels).flatMap((values) =>
      values.map((entry) => entry.locale),
    ),
  ];
}

describe("buildPhoneChangeAdHocMetadataRequest", () => {
  it("binds the metadata to the entry's own type", () => {
    expect(buildPhoneChangeAdHocMetadataRequest().transaction_data_type).toBe(
      PHONE_CHANGE_TRANSACTION_DATA_TYPE,
    );
  });

  it("targets the Sparkassen Authenticator credential type", () => {
    expect(buildPhoneChangeAdHocMetadataRequest().credential_type_id).toBe(
      SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
    );
  });

  it("asks for a 900-second TTL", () => {
    expect(PHONE_CHANGE_METADATA_TTL_SECS).toBe(900);
    expect(buildPhoneChangeAdHocMetadataRequest().ttl_secs).toBe(900);
  });

  it("declares exactly two claims, old then new", () => {
    expect(metadataOf().claims.map((claim) => claim.path)).toEqual([
      ["old_phone"],
      ["new_phone"],
    ]);
  });

  /**
   * THE test of this module. PaSO View §3 says a wallet shall exclude an entry
   * whose declared `value_type` it does not support — the ENTRY, not the label
   * — so an invented `phone_number` or `e164` is a hard refusal of the whole
   * presentation, not a row degrading to text.
   */
  it("declares NO value_type on either claim", () => {
    for (const claim of metadataOf().claims) {
      expect(claim).not.toHaveProperty("value_type");
    }
  });

  it("marks both claims mandatory", () => {
    for (const claim of metadataOf().claims) {
      expect(claim.mandatory).toBe(true);
    }
  });

  it("names both claims in English and German", () => {
    expect(metadataOf().claims[0]?.display).toEqual([
      { locale: "en", name: "Current mobile number" },
      { locale: "de", name: "Aktuelle Mobilnummer" },
    ]);
    expect(metadataOf().claims[1]?.display).toEqual([
      { locale: "en", name: "New mobile number" },
      { locale: "de", name: "Neue Mobilnummer" },
    ]);
  });

  /**
   * Region tags broke EVERY real presentation of the limit change with
   * "Transaction can't be displayed" (2026-10-19). RFC4647 Lookup only ever
   * shortens the user's range, so `en-US` is reachable from `en-US` alone
   * while `en` is reachable from `en`, `en-GB`, `en-IE` and the rest.
   */
  it("uses BARE locale tags everywhere", () => {
    const locales = allLocales(metadataOf());
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      expect(["en", "de"]).toContain(locale);
    }
  });

  it("carries all four ui_labels", () => {
    expect(Object.keys(metadataOf().ui_labels).sort()).toEqual([
      "affirmative_action_label",
      "denial_action_label",
      "security_hint",
      "transaction_title",
    ]);
  });

  it("says Confirm number on the affirmative action", () => {
    expect(metadataOf().ui_labels.affirmative_action_label).toEqual([
      { locale: "en", value: "Confirm number" },
      { locale: "de", value: "Nummer bestätigen" },
    ]);
  });

  it("offers Cancel on the denial action", () => {
    expect(metadataOf().ui_labels.denial_action_label).toEqual([
      { locale: "en", value: "Cancel" },
      { locale: "de", value: "Abbrechen" },
    ]);
  });

  /**
   * PaSO §3.2 requires a wallet to display this verbatim and forbids altering
   * or removing it, which is exactly the property wanted: redirecting a
   * victim's mobile number is a standard step in account takeover, and the
   * bank's warning must not be dressable-up by whatever drives the browser.
   */
  it("carries the security hint verbatim in both locales", () => {
    expect(metadataOf().ui_labels.security_hint).toEqual([
      {
        locale: "en",
        value: "Sparkasse will never ask you to change your mobile number.",
      },
      {
        locale: "de",
        value:
          "Die Sparkasse wird Sie niemals bitten, Ihre Mobilnummer zu ändern.",
      },
    ]);
  });
});

describe("buildPhoneChangeTransactionData", () => {
  it("returns exactly one entry", () => {
    expect(
      buildPhoneChangeTransactionData({
        oldPhone: "+49 171 5555555",
        newPhone: "+49 172 66666666",
        metadataJwt: "a.b.c",
      }),
    ).toHaveLength(1);
  });

  it("names the phone-change transaction data type", () => {
    expect(entryOf().type).toBe(PHONE_CHANGE_TRANSACTION_DATA_TYPE);
    expect(PHONE_CHANGE_TRANSACTION_DATA_TYPE).toBe(
      "urn:paso:sca:dev.digitallabor:phone-change:1",
    );
  });

  /**
   * foundry validates this list against the resolved named query's credential
   * ids and answers 400 on an unknown one. The query id and the credential
   * type id share a spelling and are deliberately separate constants, so this
   * asserts the right one is read.
   */
  it("uses the DCQL query id, not the credential type id", () => {
    expect(entryOf().credential_ids).toEqual([SPARKASSEN_AUTH_QUERY_ID]);
  });

  it("states sha-256 explicitly", () => {
    expect(entryOf().transaction_data_hashes_alg).toEqual(["sha-256"]);
  });

  it("carries the two numbers verbatim in the payload", () => {
    expect(entryOf().payload).toEqual({
      old_phone: "+49 171 5555555",
      new_phone: "+49 172 66666666",
    });
  });

  it("carries the minted jwt as metadata, unwrapped", () => {
    expect(entryOf("+49 171 5555555", "+49 172 66666666", "x.y.z").metadata).toBe(
      "x.y.z",
    );
  });

  it("has no payload member beyond the two numbers", () => {
    expect(Object.keys(entryOf().payload)).toEqual(["old_phone", "new_phone"]);
  });

  it("applies no derivation at all to the stored strings", () => {
    // The payload is hashed into `transaction_data_hashes`, so anything done
    // between the column and this entry becomes part of the signed artefact.
    const entry = entryOf("  +49 171  5555555 ", "+491725555555");
    expect(entry.payload.old_phone).toBe("  +49 171  5555555 ");
    expect(entry.payload.new_phone).toBe("+491725555555");
  });
});