import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword", () => {
  it("produces a scrypt$salt$hash triple", () => {
    const stored = hashPassword("demo1234");
    const parts = stored.split("$");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{128}$/);
  });

  it("salts, so the same password hashes differently each time", () => {
    expect(hashPassword("demo1234")).not.toBe(hashPassword("demo1234"));
  });

  it("never stores the plaintext", () => {
    expect(hashPassword("demo1234")).not.toContain("demo1234");
  });
});

describe("verifyPassword", () => {
  it("accepts the correct password", () => {
    expect(verifyPassword("demo1234", hashPassword("demo1234"))).toBe(true);
  });

  it("rejects the wrong password", () => {
    expect(verifyPassword("wrong", hashPassword("demo1234"))).toBe(false);
  });

  it("rejects a password differing only in case", () => {
    expect(verifyPassword("Demo1234", hashPassword("demo1234"))).toBe(false);
  });

  it("returns false rather than throwing on malformed stored values", () => {
    expect(verifyPassword("x", "")).toBe(false);
    expect(verifyPassword("x", "plaintext")).toBe(false);
    expect(verifyPassword("x", "scrypt$deadbeef")).toBe(false);
    expect(verifyPassword("x", "bcrypt$aa$bb")).toBe(false);
    expect(verifyPassword("x", "scrypt$zz$zz")).toBe(false);
  });
});