import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { credentials, loginSessions, users } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "./credential-types.js";
import {
  LOGIN_SESSION_TTL_MS,
  claimLoginSession,
  getLoginSessionStatus,
  refreshLoginSessionState,
  startLoginSession,
} from "./login-sessions.js";

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

  it("binds the login datetime with transaction_data", async () => {
    // transaction_data binds whatever the holder is approving — not only an
    // amount. For a login that is the moment itself, which is what makes a
    // captured vp_token non-replayable.
    const captures: Capture[] = [];
    await startLoginSession(
      db,
      stubClient(captures, REQUEST_URI_OK),
      false,
      Date.UTC(2026, 7, 25, 16, 45, 0, 123),
    );

    expect(captures[0]?.body["transaction_data"]).toEqual([
      {
        type: "urn:paso:sca:dev.digitallabor:login:1",
        credential_ids: ["sparkassen_auth"],
        transaction_data_hashes_alg: ["sha-256"],
        payload: { login_datetime: "2026-08-25T16:45:00Z" },
      },
    ]);
  });

  it("binds the datetime of the injected instant, not of the clock", async () => {
    const captures: Capture[] = [];
    await startLoginSession(db, stubClient(captures, REQUEST_URI_OK), false, 0);

    const [entry] = captures[0]?.body["transaction_data"] as Record<
      string,
      unknown
    >[];
    expect(entry?.payload).toEqual({
      login_datetime: "1970-01-01T00:00:00Z",
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
/** A foundry stub whose verification-status GET returns a fixed verdict. */
function verdictClient(verdict: unknown, status = 200): FoundryClient {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/admin/verification/requests/")) {
      return new Response(JSON.stringify(verdict), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(REQUEST_URI_OK.body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

/**
 * A normal good verdict: the authenticator answered AND signed over the login
 * transaction_data. `bound: false` models a wallet that ignored the entry —
 * the case the gate exists for.
 */
function authVerdict(sub: unknown, verified = true, bound = true) {
  return {
    id: "v_login_1",
    state: verified ? "verified" : "failed",
    created_at: 0,
    result: {
      verified,
      checks: [],
      credentials: [
        {
          query_id: "sparkassen_auth",
          format: "dc+sd-jwt",
          claims: { sub },
          checks: bound
            ? [{ check: "transaction_data_binding", passed: true }]
            : [],
        },
      ],
    },
  };
}

/** Issues an authenticator credential row for `user_anna` carrying `sub`. */
function giveAnnaAuthenticator(sub: string): void {
  db.insert(credentials)
    .values({
      id: `cred_${sub}`,
      userId: "user_anna",
      cardId: null,
      credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
      credentialId: sub,
      foundryTxId: null,
      state: "active",
      createdAt: 1,
    })
    .run();
}

/** Starts a session and returns its id, with foundry answering happily. */
async function openSession(): Promise<string> {
  const result = await startLoginSession(
    db,
    stubClient([], REQUEST_URI_OK),
    false,
  );
  if (!result.ok) throw new Error("fixture failed to open a session");
  return result.sessionId;
}

/** A foundry client whose every call throws. */
function unreachableClient(message: string): FoundryClient {
  const fetchImpl = (async () => {
    throw new Error(message);
  }) as unknown as typeof fetch;
  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

describe("refreshLoginSessionState", () => {
  it("reports not_found for an unknown id", async () => {
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("s")),
      "login_nope",
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("stays pending while foundry has no verdict", async () => {
    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient({ id: "v_login_1", state: "pending", created_at: 0 }),
      id,
    );
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("stays pending when foundry is unreachable, so a later poll recovers", async () => {
    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      unreachableClient("network down"),
      id,
    );
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("resolves a known subject to its user and verifies", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-anna")),
      id,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
    const row = db
      .select()
      .from(loginSessions)
      .where(eq(loginSessions.id, id))
      .get();
    expect(row?.userId).toBe("user_anna");
  });

  it("fails with unknown_credential when no row carries that sub", async () => {
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("never-issued")),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "unknown_credential" },
    });
  });

  it("refuses a sub that belongs to a payment credential", async () => {
    // credential_id is one column carrying the DPC's id, psu_id AND sub. The
    // type predicate is what stops a payment join key authenticating.
    db.insert(credentials)
      .values({
        id: "cred_wero",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "wero",
        credentialId: "shared-value",
        foundryTxId: null,
        state: "active",
        createdAt: 1,
      })
      .run();

    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("shared-value")),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "unknown_credential" },
    });
  });

  it("logs in against a credential row that never reached active", async () => {
    // Nothing in this project clears an `offered` row, and foundry's verdict
    // is the authority that the credential is real. A stalled status poll must
    // not lock a customer out of a credential demonstrably in their wallet.
    db.insert(credentials)
      .values({
        id: "cred_offered",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
        credentialId: "sub-offered",
        foundryTxId: "tx",
        state: "offered",
        createdAt: 1,
      })
      .run();

    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-offered")),
      id,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
  });

  it("fails when foundry says the presentation did not verify", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-anna", false)),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("fails when the verdict carries no usable sub", async () => {
    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict(42)),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("fails when only a payment credential answered", async () => {
    const id = await openSession();
    const result = await refreshLoginSessionState(
      db,
      verdictClient({
        id: "v_login_1",
        state: "verified",
        created_at: 0,
        result: {
          verified: true,
          checks: [],
          credentials: [
            {
              query_id: "sparkassencard",
              format: "dc+sd-jwt",
              claims: { sub: "sub-anna" },
              checks: [],
            },
          ],
        },
      }),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("fails when the wallet did not sign over the login datetime", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-anna", true, false)),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: {
        state: "failed",
        failureReason: "transaction_data_binding_failed",
      },
    });
  });

  it("names no customer on an unbound presentation", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();

    await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("sub-anna", true, false)),
      id,
    );

    const row = db
      .select()
      .from(loginSessions)
      .where(eq(loginSessions.id, id))
      .get();
    expect(row?.userId).toBeNull();
  });

  it("reports the missing binding rather than the unknown sub", async () => {
    // Pins the ORDER: the binding gate runs before the customer lookup, so an
    // unbound presentation never reaches the point of naming anyone. Both
    // reasons are true here; only one is the reason to report.
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("never-issued", true, false)),
      id,
    );

    expect(result).toMatchObject({
      ok: true,
      status: {
        state: "failed",
        failureReason: "transaction_data_binding_failed",
      },
    });
  });

  it("expires a session past its TTL without calling foundry", async () => {
    const id = await openSession();

    const result = await refreshLoginSessionState(
      db,
      unreachableClient("foundry must not be called for an expired session"),
      id,
      Date.now() + LOGIN_SESSION_TTL_MS + 1,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "expired" },
    });
  });

  it("does no further work once the session is terminal", async () => {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();
    await refreshLoginSessionState(db, verdictClient(authVerdict("sub-anna")), id);

    // A second poll on a verified session must not re-query foundry.
    const result = await refreshLoginSessionState(
      db,
      unreachableClient("foundry must not be called again"),
      id,
    );
    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
  });
});

describe("claimLoginSession", () => {
  /** Drives a session all the way to `verified` for Anna. */
  async function verifiedSession(): Promise<string> {
    giveAnnaAuthenticator("sub-anna");
    const id = await openSession();
    await refreshLoginSessionState(db, verdictClient(authVerdict("sub-anna")), id);
    return id;
  }

  it("reports not_found for an unknown id", () => {
    expect(claimLoginSession(db, "login_nope")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses a session that is still pending", async () => {
    const id = await openSession();
    expect(claimLoginSession(db, id)).toEqual({
      ok: false,
      reason: "not_verified",
    });
  });

  it("refuses a failed session", async () => {
    const id = await openSession();
    await refreshLoginSessionState(
      db,
      verdictClient(authVerdict("never-issued")),
      id,
    );
    expect(claimLoginSession(db, id)).toEqual({
      ok: false,
      reason: "not_verified",
    });
  });

  it("returns the resolved user for a verified session", async () => {
    const id = await verifiedSession();
    const result = claimLoginSession(db, id);
    expect(result).toEqual({
      ok: true,
      userId: "user_anna",
      displayName: expect.any(String),
    });
  });

  it("marks the session consumed", async () => {
    const id = await verifiedSession();
    claimLoginSession(db, id);
    const row = db
      .select()
      .from(loginSessions)
      .where(eq(loginSessions.id, id))
      .get();
    expect(row?.state).toBe("consumed");
  });

  it("refuses a second claim — the session is single-use", async () => {
    const id = await verifiedSession();
    expect(claimLoginSession(db, id).ok).toBe(true);
    expect(claimLoginSession(db, id)).toEqual({
      ok: false,
      reason: "already_consumed",
    });
  });

  it("refuses a verified session past its TTL and records why", async () => {
    const id = await verifiedSession();
    const result = claimLoginSession(
      db,
      id,
      Date.now() + LOGIN_SESSION_TTL_MS + 1,
    );

    expect(result).toEqual({ ok: false, reason: "expired" });
    const row = db
      .select()
      .from(loginSessions)
      .where(eq(loginSessions.id, id))
      .get();
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("expired");
  });

  it("reads the display name at claim time rather than from the session", async () => {
    const id = await verifiedSession();
    db.update(users)
      .set({ displayName: "Renamed Later" })
      .where(eq(users.id, "user_anna"))
      .run();

    expect(claimLoginSession(db, id)).toMatchObject({
      ok: true,
      displayName: "Renamed Later",
    });
  });
});
