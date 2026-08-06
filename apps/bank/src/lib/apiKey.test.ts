import { describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    PORT: 3001,
    DATABASE_PATH: ":memory:",
    BANK_PUBLIC_URL: "http://localhost:3001",
    FOUNDRY_ADMIN_URL: "http://127.0.0.1:9000",
    FOUNDRY_ADMIN_KEY: "k",
    BANK_API_KEY: "dev-bank-api-key",
    SESSION_SECRET: "0123456789012345678901234567890123456789",
  },
}));

const { InvalidApiKeyError, requireApiKey } = await import("./apiKey.js");

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/payments", { headers });
}

describe("requireApiKey", () => {
  it("does not throw for the correct key", () => {
    expect(() => requireApiKey(request({ "x-api-key": "dev-bank-api-key" }))).not.toThrow();
  });

  it("throws InvalidApiKeyError when the header is missing", () => {
    expect(() => requireApiKey(request())).toThrow(InvalidApiKeyError);
  });

  it("throws InvalidApiKeyError for a wrong key of the same length", () => {
    expect(() => requireApiKey(request({ "x-api-key": "dev-bank-api-kez" }))).toThrow(
      InvalidApiKeyError,
    );
  });

  it("throws InvalidApiKeyError for a key of a different length", () => {
    expect(() => requireApiKey(request({ "x-api-key": "short" }))).toThrow(InvalidApiKeyError);
  });
});