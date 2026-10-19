/**
 * The wire contract of all four limit-change routes.
 *
 * The exact-key-set assertion below is the point of the first describe. A route
 * body is a hand-maintained projection, and this repo has already shipped one
 * bug where a member existed everywhere except the `NextResponse.json` literal
 * — `dcApiProtocol`, fixed in 6e997da. A type cannot catch it, because
 * `JSON.stringify` silently drops `undefined`. Only parsing the response can.
 *
 * The rest of the file is about the two things a route owns that a lib function
 * cannot: the status-code mapping, and reading a dynamic segment off a URL
 * without throwing on one it did not anticipate.
 */

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/index.js";
import { accounts, credentials, limitChangeSessions } from "@/db/schema.js";
import { seed } from "@/db/seed.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "@/lib/credential-types.js";

const dbStub = vi.hoisted(() => ({ db: null as unknown }));
const sessionStub = vi.hoisted(() => ({ userId: "user_anna" }));
/** Scripted per path, so the mint and the verification request fail apart. */
const foundryStub = vi.hoisted(() => ({
  mint: null as null | { status: number; body: unknown },
  verify: null as null | { status: number; body: unknown },
  calls: [] as string[],
}));

vi.mock("@/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/index.js")>()),
  getDb: () => dbStub.db,
}));

// withSession's guard is exercised by session.test.ts; this file is about what
// the handlers do with a session, so the session is supplied rather than minted.
vi.mock("@/lib/session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session.js")>()),
  requireSession: async () => ({
    userId: sessionStub.userId,
    displayName: "Anna",
  }),
}));

// The routes reach foundry through a memoized singleton pointed at a real
// admin listener. Replaced wholesale so no HTTP leaves this test.
vi.mock("@/lib/foundry.js", async () => {
  const { FoundryClient } = await import("@demo/foundry-client");
  const fetchImpl = (async (input: unknown, _init?: RequestInit) => {
    const url = String(input);
    foundryStub.calls.push(url);
    const reply = url.includes("/admin/paso/ad-hoc-metadata")
      ? foundryStub.mint
      : foundryStub.verify;
    if (!reply) throw new Error(`no foundry reply scripted for ${url}`);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return {
    getFoundry: () =>
      new FoundryClient({
        adminUrl: "http://f:9000",
        adminKey: "k",
        fetchImpl,
      }),
  };
});

const { POST } = await import("./route.js");
const { GET: POLL } = await import("./[sessionId]/route.js");
const { POST: APPLY } = await import("./[sessionId]/apply/route.js");
const { POST: RELAY } = await import("./[sessionId]/dc-api-response/route.js");

const MINT_OK = { status: 200, body: { jwt: "a.b.c", exp: 1792427805 } };
const REQUEST_URI_OK = {
  status: 200,
  body: {
    verification_id: "v_limit_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};
const DC_API_SIGNED_OK = {
  status: 200,
  body: {
    verification_id: "v_limit_2",
    dc_api_request: { request: "eyJ0.eyJ1.sig" },
    protocol: "openid4vp-v1-signed",
  },
};

let db: Db;

beforeEach(() => {
  db = createDb(":memory:");
  dbStub.db = db;
  seed(db);
  sessionStub.userId = "user_anna";
  foundryStub.mint = MINT_OK;
  foundryStub.verify = REQUEST_URI_OK;
  foundryStub.calls = [];
});

function start(accountId: string, body: unknown): Request {
  return new Request(`http://b/api/accounts/${accountId}/limit-change`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function onlyRow() {
  return db.select().from(limitChangeSessions).get();
}

describe("POST /api/accounts/[id]/limit-change", () => {
  it("answers 201 with exactly the session's own prop names", async () => {
    const response = await POST(start("acc_anna", { newLimitCents: 200_000 }));
    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    // Exact, not a subset: the defect this guards against is an ABSENT member.
    expect(Object.keys(body).sort()).toEqual([
      "accountId",
      "dcApiProtocol",
      "dcApiRequest",
      "newLimitCents",
      "oldLimitCents",
      "sessionId",
      "state",
      "transport",
      "uri",
    ]);
  });

  it("agrees with the row it wrote", async () => {
    foundryStub.verify = DC_API_SIGNED_OK;
    const response = await POST(
      start("acc_anna", { newLimitCents: 200_000, transport: "dc_api_signed" }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    const row = onlyRow()!;

    expect(body.sessionId).toBe(row.id);
    expect(body.accountId).toBe(row.accountId);
    expect(body.transport).toBe(row.transport);
    expect(body.oldLimitCents).toBe(row.oldLimitCents);
    expect(body.newLimitCents).toBe(row.newLimitCents);
    expect(body.state).toBe(row.state);
    // The member this repo lost at exactly this seam once already.
    expect(body.dcApiProtocol).toBe(row.dcApiProtocol);
    expect(JSON.stringify(body.dcApiRequest)).toBe(row.dcApiRequestJson);
  });

  it("defaults to the cross-device transport when none is named", async () => {
    const response = await POST(start("acc_anna", { newLimitCents: 200_000 }));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.transport).toBe("request_uri");
    expect(body.dcApiProtocol).toBeNull();
  });

  /** Review Focus 3 — things the dialog structurally cannot send. */
  it("answers 400 for a non-preset newLimitCents", async () => {
    const response = await POST(start("acc_anna", { newLimitCents: 150_000 }));
    expect(response.status).toBe(400);
    expect(foundryStub.calls).toHaveLength(0);
  });

  it("answers 400 for the limit already in force", async () => {
    const response = await POST(start("acc_anna", { newLimitCents: 100_000 }));
    expect(response.status).toBe(400);
  });

  it("answers 400 for a missing body", async () => {
    const response = await POST(
      new Request("http://b/api/accounts/acc_anna/limit-change", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("answers 400 for an unparseable body", async () => {
    const response = await POST(start("acc_anna", "{not json"));
    expect(response.status).toBe(400);
  });

  it("answers 400 for a newLimitCents that is not a number", async () => {
    // Unlike the wallet-login route, every field here is required, so there IS
    // a request a 400 usefully rejects.
    const response = await POST(start("acc_anna", { newLimitCents: "200000" }));
    expect(response.status).toBe(400);
  });

  it("answers 400 for an unknown transport rather than forwarding it", async () => {
    // A closed enum: the value is forwarded to foundry verbatim, and an
    // unknown transport there does not fail loudly — it falls through to
    // direct_post.jwt.
    const response = await POST(
      start("acc_anna", { newLimitCents: 200_000, transport: "carrier_pigeon" }),
    );
    expect(response.status).toBe(400);
  });

  /** Review Focus 4. */
  it("answers 404 for an account the caller does not own", async () => {
    const response = await POST(start("acc_ben", { newLimitCents: 200_000 }));
    expect(response.status).toBe(404);
    expect(foundryStub.calls).toHaveLength(0);
    expect(onlyRow()).toBeUndefined();
  });

  it("answers 404 for an account that does not exist", async () => {
    const response = await POST(start("acc_nope", { newLimitCents: 200_000 }));
    expect(response.status).toBe(404);
  });

  it("answers 502 when foundry cannot be reached", async () => {
    foundryStub.verify = { status: 500, body: {} };
    const response = await POST(start("acc_anna", { newLimitCents: 200_000 }));
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe(
      "foundry_unavailable",
    );
  });

  it("answers 502 when the metadata cannot be minted", async () => {
    foundryStub.mint = { status: 400, body: { error: "bad metadata" } };
    const response = await POST(start("acc_anna", { newLimitCents: 200_000 }));
    expect(response.status).toBe(502);
    // A distinct reason on the wire, so an operator reading a log can tell the
    // two foundry failures apart even though both are 502.
    expect(((await response.json()) as { error: string }).error).toBe(
      "metadata_unavailable",
    );
  });
});

/** Opens a session through the route and returns its id. */
async function openSession(): Promise<string> {
  const response = await POST(start("acc_anna", { newLimitCents: 200_000 }));
  const body = (await response.json()) as { sessionId: string };
  return body.sessionId;
}

describe("GET /api/accounts/[id]/limit-change/[sessionId]", () => {
  function poll(accountId: string, sessionId: string): Request {
    return new Request(
      `http://b/api/accounts/${accountId}/limit-change/${sessionId}`,
    );
  }

  it("answers 200 with the status the dialog polls", async () => {
    const sessionId = await openSession();
    foundryStub.verify = {
      status: 200,
      body: { id: "v_limit_1", state: "pending", created_at: 0 },
    };

    const response = await POLL(poll("acc_anna", sessionId));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ state: "pending", newLimitCents: 200_000 });
  });

  it("answers 404 for another user's session", async () => {
    const sessionId = await openSession();
    sessionStub.userId = "user_ben";
    expect((await POLL(poll("acc_anna", sessionId))).status).toBe(404);
  });

  it("answers 404 for the right session under the wrong account", async () => {
    const sessionId = await openSession();
    expect((await POLL(poll("acc_ben", sessionId))).status).toBe(404);
  });

  it("answers 404 for a session that does not exist", async () => {
    expect((await POLL(poll("acc_anna", "limit_nope"))).status).toBe(404);
  });

  it("reads the session id from the path without throwing on a malformed url", async () => {
    // Split as a plain string rather than through `new URL(..)`, which throws
    // on a value it cannot parse. An unreadable id must fall through to the
    // same 404 as an absent one, not become a 500.
    const response = await POLL(
      new Request("http://b/api/accounts/acc_anna/limit-change/%%%?x=1"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/accounts/[id]/limit-change/[sessionId]/apply", () => {
  function apply(accountId: string, sessionId: string): Request {
    return new Request(
      `http://b/api/accounts/${accountId}/limit-change/${sessionId}/apply`,
      { method: "POST" },
    );
  }

  /** Drives a session to `verified` through the poll route. */
  async function verified(): Promise<string> {
    db.insert(credentials)
      .values({
        id: "cred_anna_auth",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
        credentialId: "sub-anna",
        state: "active",
        createdAt: 1,
      })
      .run();
    const sessionId = await openSession();
    foundryStub.verify = {
      status: 200,
      body: {
        id: "v_limit_1",
        state: "verified",
        created_at: 0,
        result: {
          verified: true,
          checks: [],
          credentials: [
            {
              query_id: "sparkassen_auth",
              format: "dc+sd-jwt",
              claims: { sub: "sub-anna" },
              checks: [{ check: "transaction_data_binding", passed: true }],
            },
          ],
        },
      },
    };
    await POLL(
      new Request(
        `http://b/api/accounts/acc_anna/limit-change/${sessionId}`,
      ),
    );
    return sessionId;
  }

  it("answers 200 with the written limit", async () => {
    const sessionId = await verified();
    const response = await APPLY(apply("acc_anna", sessionId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ dailyLimitCents: 200_000 });
    expect(
      db.select().from(accounts).where(eq(accounts.id, "acc_anna")).get()
        ?.dailyLimitCents,
    ).toBe(200_000);
  });

  it("answers 410 for a second apply", async () => {
    const sessionId = await verified();
    await APPLY(apply("acc_anna", sessionId));
    const response = await APPLY(apply("acc_anna", sessionId));
    // Gone for good, not "might yet arrive" — hence 410 rather than 409.
    expect(response.status).toBe(410);
  });

  it("answers 409 for a session that is not verified yet", async () => {
    const sessionId = await openSession();
    expect((await APPLY(apply("acc_anna", sessionId))).status).toBe(409);
  });

  it("answers 409 when the limit moved underneath", async () => {
    const sessionId = await verified();
    db.update(accounts)
      .set({ dailyLimitCents: 500_000 })
      .where(eq(accounts.id, "acc_anna"))
      .run();
    const response = await APPLY(apply("acc_anna", sessionId));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(
      "limit_changed",
    );
  });

  it("answers 404 for another user's session", async () => {
    const sessionId = await verified();
    sessionStub.userId = "user_ben";
    expect((await APPLY(apply("acc_anna", sessionId))).status).toBe(404);
  });

  it("answers 404 for the right session under the wrong account", async () => {
    const sessionId = await verified();
    expect((await APPLY(apply("acc_ben", sessionId))).status).toBe(404);
  });
});

describe("POST /api/accounts/[id]/limit-change/[sessionId]/dc-api-response", () => {
  function relay(accountId: string, sessionId: string, body: unknown): Request {
    return new Request(
      `http://b/api/accounts/${accountId}/limit-change/${sessionId}/dc-api-response`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  }

  it("answers 204 and discards foundry's verdict", async () => {
    const sessionId = await openSession();
    foundryStub.verify = {
      status: 200,
      body: { verified: true, checks: [], credentials: [] },
    };

    const response = await RELAY(
      relay("acc_anna", sessionId, { response: "jwe" }),
    );
    // 204, so the poll remains the single state path.
    expect(response.status).toBe(204);
    expect(onlyRow()?.state).toBe("pending");
  });

  it("answers 400 for a missing response", async () => {
    const sessionId = await openSession();
    expect(
      (await RELAY(relay("acc_anna", sessionId, {}))).status,
    ).toBe(400);
  });

  it("answers 404 for another user's session", async () => {
    const sessionId = await openSession();
    sessionStub.userId = "user_ben";
    expect(
      (await RELAY(relay("acc_anna", sessionId, { response: "jwe" }))).status,
    ).toBe(404);
  });

  it("answers 502 when foundry cannot be reached", async () => {
    const sessionId = await openSession();
    foundryStub.verify = { status: 500, body: {} };
    expect(
      (await RELAY(relay("acc_anna", sessionId, { response: "jwe" }))).status,
    ).toBe(502);
  });
});