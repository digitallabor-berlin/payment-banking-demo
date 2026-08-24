import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { loginSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { getLoginSessionStatus, startLoginSession } from "./login-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-login-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Capture {
  url: string;
  body: Record<string, unknown>;
}

function stubClient(
  captures: Capture[],
  reply: { status: number; body: unknown },
): FoundryClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    captures.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

const REQUEST_URI_OK = {
  status: 200,
  body: {
    verification_id: "v_login_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};

const DC_API_OK = {
  status: 200,
  body: {
    verification_id: "v_login_2",
    openid4vp_uri: null,
    request_uri: null,
    dc_api_request: { response_mode: "dc_api.jwt", nonce: "n" },
  },
};

describe("startLoginSession", () => {
  it("asks foundry for the sparkassen_auth named query", async () => {
    const captures: Capture[] = [];
    await startLoginSession(db, stubClient(captures, REQUEST_URI_OK), false);

    expect(captures[0]?.url).toBe("http://f:9000/admin/verification/requests");
    expect(captures[0]?.body["named_query_ref"]).toBe("sparkassen_auth");
    expect(captures[0]?.body["transport"]).toBe("request_uri");
  });

  it("sends no transaction_data — a login binds no amount", () => {
    // transaction_data binds an amount to a presentation. There is no amount
    // in a login, so sending one would hash a value that means nothing.
    const captures: Capture[] = [];
    return startLoginSession(
      db,
      stubClient(captures, REQUEST_URI_OK),
      false,
    ).then(() => {
      expect(captures[0]?.body).not.toHaveProperty("transaction_data");
    });
  });

  it("sends no dcql_query alongside the named query", async () => {
    // foundry prefers an inline query and would silently ignore the named one.
    const captures: Capture[] = [];
    await startLoginSession(db, stubClient(captures, REQUEST_URI_OK), false);
    expect(captures[0]?.body).not.toHaveProperty("dcql_query");
  });

  it("returns the openid4vp uri under request_uri", async () => {
    const result = await startLoginSession(
      db,
      stubClient([], REQUEST_URI_OK),
      false,
    );
    expect(result).toMatchObject({
      ok: true,
      transport: "request_uri",
      state: "pending",
      uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
      dcApiRequest: null,
    });
  });

  it("mints a login_-prefixed session id", async () => {
    const result = await startLoginSession(
      db,
      stubClient([], REQUEST_URI_OK),
      false,
    );
    expect(result.ok && result.sessionId.startsWith("login_")).toBe(true);
  });

  it("returns the inline request object under dc_api and no uri", async () => {
    const captures: Capture[] = [];
    const result = await startLoginSession(
      db,
      stubClient(captures, DC_API_OK),
      true,
    );

    expect(captures[0]?.body["transport"]).toBe("dc_api");
    expect(result).toMatchObject({
      ok: true,
      transport: "dc_api",
      uri: null,
      dcApiRequest: { response_mode: "dc_api.jwt", nonce: "n" },
    });
  });

  it("persists foundry's ids and the transport", async () => {
    const result = await startLoginSession(
      db,
      stubClient([], REQUEST_URI_OK),
      false,
    );
    const row = db.select().from(loginSessions).get();

    expect(result.ok && row?.id).toBe(result.ok ? result.sessionId : null);
    expect(row?.foundryVerificationId).toBe("v_login_1");
    expect(row?.requestUri).toBe("https://f/req/1");
    expect(row?.transport).toBe("request_uri");
    expect(row?.state).toBe("pending");
    expect(row?.userId).toBeNull();
  });

  it("stores the inline request object as JSON under dc_api", async () => {
    await startLoginSession(db, stubClient([], DC_API_OK), true);
    const row = db.select().from(loginSessions).get();
    expect(JSON.parse(row?.dcApiRequestJson ?? "null")).toEqual({
      response_mode: "dc_api.jwt",
      nonce: "n",
    });
  });

  it("leaves a visible failed row when foundry refuses", async () => {
    const result = await startLoginSession(
      db,
      stubClient([], { status: 500, body: { error: "unknown named query" } }),
      false,
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(loginSessions).get();
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("foundry_unavailable");
  });

  it("records the requested transport even on a failed row", async () => {
    await startLoginSession(db, stubClient([], { status: 500, body: {} }), true);
    expect(db.select().from(loginSessions).get()?.transport).toBe("dc_api");
  });
});

describe("getLoginSessionStatus", () => {
  it("returns null for an unknown id", () => {
    expect(getLoginSessionStatus(db, "login_nope")).toBeNull();
  });

  it("returns the state with no failureReason when there is none", async () => {
    const result = await startLoginSession(
      db,
      stubClient([], REQUEST_URI_OK),
      false,
    );
    const status = getLoginSessionStatus(db, result.ok ? result.sessionId : "");
    expect(status).toEqual({ state: "pending" });
  });

  it("returns the failure reason when the row carries one", async () => {
    await startLoginSession(db, stubClient([], { status: 500, body: {} }), false);
    const row = db.select().from(loginSessions).get();
    expect(getLoginSessionStatus(db, row?.id ?? "")).toEqual({
      state: "failed",
      failureReason: "foundry_unavailable",
    });
  });
});