import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const complete = {
  FOUNDRY_ADMIN_KEY: "admin-key",
  BANK_API_KEY: "bank-key",
  MERCHANT_PAYEE_ID: "Payee-id-123",
  FOUNDRY_WEBHOOK_SECRET: "webhook-secret",
};

describe("parseEnv", () => {
  it("applies documented defaults for non-secret values", () => {
    const env = parseEnv(complete);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_PATH).toBe("./data/merchant.db");
    expect(env.MERCHANT_PUBLIC_URL).toBe("http://localhost:3000");
    expect(env.FOUNDRY_ADMIN_URL).toBe("http://127.0.0.1:9000");
    expect(env.BANK_API_URL).toBe("http://localhost:3001");
    expect(env.MERCHANT_NAME).toBe("Demo Shop");
  });

  it("coerces PORT to a number", () => {
    expect(parseEnv({ ...complete, PORT: "4000" }).PORT).toBe(4000);
  });

  it("throws a named error listing every missing secret", () => {
    expect(() => parseEnv({})).toThrowError(/FOUNDRY_ADMIN_KEY/);
    expect(() => parseEnv({})).toThrowError(/BANK_API_KEY/);
  });

  it("requires MERCHANT_PAYEE_ID rather than defaulting it", () => {
    // It lands in transaction_data.payload.payee.id, which the wallet shows
    // and hashes into transaction_data_hashes. A placeholder default would
    // ship a lie into a signed authorization, so absence has to be a boot
    // failure exactly like a missing secret.
    const { MERCHANT_PAYEE_ID: _omitted, ...withoutPayeeId } = complete;
    expect(() => parseEnv(withoutPayeeId)).toThrowError(/MERCHANT_PAYEE_ID/);
  });

  it("carries MERCHANT_PAYEE_ID through verbatim", () => {
    expect(parseEnv(complete).MERCHANT_PAYEE_ID).toBe("Payee-id-123");
  });

  it("requires FOUNDRY_WEBHOOK_SECRET rather than defaulting it", () => {
    // The HMAC IS the authentication on /api/verifier-events. An optional
    // secret degrades that route to an unauthenticated endpoint accepting
    // holder credentials from anyone, so absence must be a boot failure.
    const { FOUNDRY_WEBHOOK_SECRET: _omitted, ...withoutSecret } = complete;
    expect(() => parseEnv(withoutSecret)).toThrowError(
      /FOUNDRY_WEBHOOK_SECRET/,
    );
  });

  it("rejects a non-URL BANK_API_URL", () => {
    expect(() => parseEnv({ ...complete, BANK_API_URL: "nope" })).toThrowError(
      /BANK_API_URL/,
    );
  });

  it("allows overriding MERCHANT_NAME", () => {
    expect(
      parseEnv({ ...complete, MERCHANT_NAME: "Other Shop" }).MERCHANT_NAME,
    ).toBe("Other Shop");
  });
});
