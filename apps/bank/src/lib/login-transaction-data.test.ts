import { describe, expect, it } from "vitest";
import {
  LOGIN_TRANSACTION_DATA_TYPE,
  buildLoginTransactionData,
  loginDatetime,
} from "./login-transaction-data.js";

/** 2026-08-25T16:45:00.123Z, chosen so the millis are non-zero. */
const NOW = Date.UTC(2026, 7, 25, 16, 45, 0, 123);

/** The single entry, read as a bag of keys so each field can be pinned. */
function entry(now: number): Record<string, unknown> {
  const [first] = buildLoginTransactionData(now);
  return first as Record<string, unknown>;
}

describe("loginDatetime", () => {
  it("renders the instant as seconds-precision UTC", () => {
    expect(loginDatetime(NOW)).toBe("2026-08-25T16:45:00Z");
  });

  it("drops milliseconds rather than rounding them", () => {
    // 999ms is still 16:45:00, never 16:45:01. The string is hashed
    // byte-for-byte, so a rounded second would silently break the binding.
    expect(loginDatetime(Date.UTC(2026, 7, 25, 16, 45, 0, 999))).toBe(
      "2026-08-25T16:45:00Z",
    );
  });

  it("never emits a fractional part", () => {
    expect(loginDatetime(NOW)).not.toContain(".");
  });

  it("marks the zone explicitly", () => {
    // Without the marker the string looks local while being UTC, which is how
    // a wallet renders a login an hour off.
    expect(loginDatetime(NOW).endsWith("Z")).toBe(true);
  });

  it("is a function of the injected instant, not the clock", () => {
    expect(loginDatetime(0)).toBe("1970-01-01T00:00:00Z");
  });
});

describe("buildLoginTransactionData", () => {
  it("returns exactly one entry", () => {
    expect(buildLoginTransactionData(NOW)).toHaveLength(1);
  });

  it("sends the login transaction data type", () => {
    expect(entry(NOW).type).toBe("urn:paso:sca:dev.digitallabor:login:1");
  });

  it("exports that type as a named constant", () => {
    expect(LOGIN_TRANSACTION_DATA_TYPE).toBe(
      "urn:paso:sca:dev.digitallabor:login:1",
    );
  });

  it("binds to the authenticator credential and nothing else", () => {
    // transaction_data binds only to the credentials it names. Naming a
    // payment credential here would bind a login to an instrument.
    expect(entry(NOW).credential_ids).toEqual(["sparkassen_auth"]);
  });

  it("states the hash algorithm explicitly", () => {
    expect(entry(NOW).transaction_data_hashes_alg).toEqual(["sha-256"]);
  });

  it("carries the login datetime as its only payload claim", () => {
    expect(entry(NOW).payload).toEqual({
      login_datetime: "2026-08-25T16:45:00Z",
    });
  });

  it("is plain JSON, not pre-encoded", () => {
    // foundry performs the OpenID4VP base64url encoding itself; a pre-encoded
    // payload here would be double-encoded.
    expect(typeof entry(NOW).payload).toBe("object");
  });
});
