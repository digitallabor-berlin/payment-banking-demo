import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const complete = {
  FOUNDRY_ADMIN_KEY: "admin-key",
  BANK_API_KEY: "bank-key",
  SESSION_SECRET: "0123456789012345678901234567890123456789",
};

describe("parseEnv", () => {
  it("applies documented defaults for non-secret values", () => {
    const env = parseEnv(complete);
    expect(env.PORT).toBe(3001);
    expect(env.DATABASE_PATH).toBe("./data/bank.db");
    expect(env.BANK_PUBLIC_URL).toBe("http://localhost:3001");
    expect(env.FOUNDRY_ADMIN_URL).toBe("http://127.0.0.1:9000");
  });

  it("coerces PORT to a number", () => {
    expect(parseEnv({ ...complete, PORT: "4000" }).PORT).toBe(4000);
  });

  it("throws a named error listing every missing secret", () => {
    expect(() => parseEnv({})).toThrowError(/FOUNDRY_ADMIN_KEY/);
    expect(() => parseEnv({})).toThrowError(/BANK_API_KEY/);
    expect(() => parseEnv({})).toThrowError(/SESSION_SECRET/);
  });

  it("rejects a SESSION_SECRET shorter than 32 characters", () => {
    expect(() => parseEnv({ ...complete, SESSION_SECRET: "short" })).toThrowError(
      /SESSION_SECRET/,
    );
  });

  it("rejects a non-URL FOUNDRY_ADMIN_URL", () => {
    expect(() => parseEnv({ ...complete, FOUNDRY_ADMIN_URL: "nope" })).toThrowError(
      /FOUNDRY_ADMIN_URL/,
    );
  });
});