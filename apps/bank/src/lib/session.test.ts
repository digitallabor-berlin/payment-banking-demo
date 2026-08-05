import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "0123456789012345678901234567890123456789";

vi.mock("../env.js", () => ({
  env: {
    PORT: 3001,
    DATABASE_PATH: ":memory:",
    BANK_PUBLIC_URL: "http://localhost:3001",
    FOUNDRY_ADMIN_URL: "http://127.0.0.1:9000",
    FOUNDRY_ADMIN_KEY: "k",
    BANK_API_KEY: "b",
    SESSION_SECRET: SECRET,
  },
}));

const { SESSION_COOKIE, signSession, verifySession } = await import("./session.js");

describe("SESSION_COOKIE", () => {
  it("is the documented cookie name", () => {
    expect(SESSION_COOKIE).toBe("bank_session");
  });
});

describe("signSession / verifySession", () => {
  let token: string;

  beforeEach(async () => {
    token = await signSession({ userId: "user_anna", displayName: "Anna Schmidt" });
  });

  it("round-trips the payload", async () => {
    await expect(verifySession(token)).resolves.toEqual({
      userId: "user_anna",
      displayName: "Anna Schmidt",
    });
  });

  it("produces a compact three-segment JWS", () => {
    expect(token.split(".")).toHaveLength(3);
  });

  it("returns null for a tampered signature", async () => {
    const [header, payload] = token.split(".");
    await expect(verifySession(`${header}.${payload}.deadbeef`)).resolves.toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    const { SignJWT } = await import("jose");
    const foreign = await new SignJWT({ userId: "u", displayName: "d" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("a-completely-different-secret-value-32ch"));
    await expect(verifySession(foreign)).resolves.toBeNull();
  });

  it("returns null for garbage input rather than throwing", async () => {
    await expect(verifySession("")).resolves.toBeNull();
    await expect(verifySession("not-a-jwt")).resolves.toBeNull();
    await expect(verifySession("a.b.c")).resolves.toBeNull();
  });

  it("returns null for an expired token", async () => {
    const { SignJWT } = await import("jose");
    const expired = await new SignJWT({ userId: "u", displayName: "d" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifySession(expired)).resolves.toBeNull();
  });

  it("returns null when the payload lacks a userId", async () => {
    const { SignJWT } = await import("jose");
    const malformed = await new SignJWT({ displayName: "d" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    await expect(verifySession(malformed)).resolves.toBeNull();
  });
});