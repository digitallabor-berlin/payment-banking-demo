import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const complete = {
  FOUNDRY_ADMIN_KEY: "admin-key",
  BANK_API_KEY: "bank-key",
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

  it("rejects a non-URL BANK_API_URL", () => {
    expect(() => parseEnv({ ...complete, BANK_API_URL: "nope" })).toThrowError(
      /BANK_API_URL/,
    );
  });

  it("allows overriding MERCHANT_NAME", () => {
    expect(parseEnv({ ...complete, MERCHANT_NAME: "Other Shop" }).MERCHANT_NAME).toBe(
      "Other Shop",
    );
  });
});