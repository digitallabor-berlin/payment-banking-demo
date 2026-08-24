import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { loginSessions } from "../db/schema.js";
import { relayDcApiResponse } from "./dc-api-relay.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-relay-"));
  db = createDb(path.join(dir, "test.db"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Capture {
  url: string;
  body: Record<string, unknown>;
}

function stub(captures: Capture[], status = 200): FoundryClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    captures.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(
      JSON.stringify({ verified: true, checks: [], credentials: [] }),
      { status, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

describe("relayDcApiResponse", () => {
  it("reports not_found for an unknown session", async () => {
    const result = await relayDcApiResponse(db, stub([]), "login_nope", "jwe");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("reports no_verification when foundry never answered the create", async () => {
    db.insert(loginSessions).values({ id: "login_1", createdAt: 1 }).run();
    const result = await relayDcApiResponse(db, stub([]), "login_1", "jwe");
    expect(result).toEqual({ ok: false, reason: "no_verification" });
  });

  it("forwards the wallet's JWE to foundry's admin endpoint", async () => {
    db.insert(loginSessions)
      .values({ id: "login_1", foundryVerificationId: "v_1", createdAt: 1 })
      .run();

    const captures: Capture[] = [];
    const result = await relayDcApiResponse(
      db,
      stub(captures),
      "login_1",
      "the-jwe",
    );

    expect(result).toEqual({ ok: true });
    expect(captures[0]?.url).toBe(
      "http://f:9000/admin/verification/requests/v_1/dc-api-response",
    );
    expect(captures[0]?.body).toEqual({ response: "the-jwe" });
  });

  it("reports foundry_unavailable on a non-2xx", async () => {
    db.insert(loginSessions)
      .values({ id: "login_1", foundryVerificationId: "v_1", createdAt: 1 })
      .run();

    const result = await relayDcApiResponse(db, stub([], 500), "login_1", "jwe");
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
  });
});