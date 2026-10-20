/**
 * The wire contract of all four phone-change routes.
 *
 * The exact-key-set assertion below is the point of the first describe. A
 * route body is a hand-maintained projection, and this repo has already
 * shipped one bug where a member existed everywhere except the
 * `NextResponse.json` literal — `dcApiProtocol`, fixed in 6e997da. A type
 * cannot catch it, because `JSON.stringify` silently drops `undefined`. Only
 * parsing the response can.
 *
 * The rest of the file is about the two things a route owns that a lib
 * function cannot: the status-code mapping, and reading a dynamic segment off
 * a URL without throwing on one it did not anticipate.
 */

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/index.js";
import { phoneChangeSessions, users } from "@/db/schema.js";
import { seed } from "@/db/seed.js";

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
    verification_id: "v_phone_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};
const DC_API_SIGNED_OK = {
  status: 200,
  body: {
    verification_id: "v_phone_2",
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

function start(body: unknown): Request {
  return new Request("http://b/api/profile/phone-change", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function poll(sessionId: string): Request {
  return new Request(`http://b/api/profile/phone-change/${sessionId}`);
}

function apply(sessionId: string): Request {
  return new Request(
    `http://b/api/profile/phone-change/${sessionId}/apply`,
    { method: "POST" },
  );
}

function relay(sessionId: string, body: unknown): Request {
  return new Request(
    `http://b/api/profile/phone-change/${sessionId}/dc-api-response`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    },
  );
}

function onlyRow() {
  return db.select().from(phoneChangeSessions).get();
}

function phoneOf(userId: string): string | undefined {
  return db.select().from(users).where(eq(users.id, userId)).get()?.phoneNumber;
}

/** Opens a session and drives its row straight to `verified`. */
async function verifiedSession(): Promise<string> {
  await POST(start({ phoneNumber: "+49 172 66666666" }));
  const sessionId = onlyRow()!.id;
  db.update(phoneChangeSessions)
    .set({ state: "verified", approvedByUserId: "user_anna" })
    .where(eq(phoneChangeSessions.id, sessionId))
    .run();
  return sessionId;
}

describe("POST /api/profile/phone-change", () => {
  it("answers 201 with exactly the session's own prop names", async () => {
    const response = await POST(start({ phoneNumber: "+49 172 66666666" }));
    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    // Exact, not a subset: the defect this guards against is an ABSENT member.
    expect(Object.keys(body).sort()).toEqual([
      "dcApiProtocol",
      "dcApiRequest",
      "newPhone",
      "oldPhone",
      "sessionId",
      "state",
      "transport",
      "uri",
    ]);
  });

  it("agrees with the row it wrote", async () => {
    foundryStub.verify = DC_API_SIGNED_OK;
    const response = await POST(
      start({ phoneNumber: "+49 172 66666666", transport: "dc_api_signed" }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    const row = onlyRow()!;

    expect(body.sessionId).toBe(row.id);
    expect(body.transport).toBe(row.transport);
    expect(body.dcApiProtocol).toBe(row.dcApiProtocol);
    expect(body.oldPhone).toBe(row.oldPhone);
    expect(body.newPhone).toBe(row.newPhone);
    expect(body.state).toBe(row.state);
  });

  it("answers 400 for a missing body", async () => {
    const response = await POST(start("not json"));
    expect(response.status).toBe(400);
    expect(onlyRow()).toBeUndefined();
  });

  it("answers 400 for a non-string phoneNumber", async () => {
    for (const phoneNumber of [491715555555, null, {}, []]) {
      const response = await POST(start({ phoneNumber }));
      expect(response.status).toBe(400);
    }
    expect(onlyRow()).toBeUndefined();
  });

  it("answers 400 for invalid_phone", async () => {
    const response = await POST(start({ phoneNumber: "0171 5555555" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_phone" });
  });

  it("answers 409 for phone_unchanged", async () => {
    const response = await POST(start({ phoneNumber: "+491715555555" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "phone_unchanged" });
  });

  it("answers 502 for metadata_unavailable", async () => {
    foundryStub.mint = { status: 503, body: {} };
    const response = await POST(start({ phoneNumber: "+49 172 66666666" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "metadata_unavailable" });
  });

  it("answers 502 for foundry_unavailable", async () => {
    foundryStub.verify = { status: 503, body: {} };
    const response = await POST(start({ phoneNumber: "+49 172 66666666" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "foundry_unavailable" });
  });

  it("rejects a bogus transport value with 400", async () => {
    // A closed enum rather than a free string: this value is forwarded to
    // foundry verbatim, and an unknown transport there does not fail loudly.
    const response = await POST(
      start({ phoneNumber: "+49 172 66666666", transport: "carrier-pigeon" }),
    );
    expect(response.status).toBe(400);
    expect(foundryStub.calls).toHaveLength(0);
  });
});

describe("GET /api/profile/phone-change/[sessionId]", () => {
  it("reads the session id from the last segment", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const sessionId = onlyRow()!.id;
    foundryStub.verify = {
      status: 200,
      body: { id: "v_phone_1", state: "pending", created_at: 0 },
    };

    const response = await POLL(poll(sessionId));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      state: "pending",
      newPhone: "+49 172 66666666",
    });
  });

  it("answers 404 for another customer's session", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const sessionId = onlyRow()!.id;
    sessionStub.userId = "user_ben";

    const response = await POLL(poll(sessionId));
    expect(response.status).toBe(404);
  });

  it("answers 404 for an unreadable id rather than throwing", async () => {
    const response = await POLL(poll("phone_nope"));
    expect(response.status).toBe(404);
  });

  it("never writes the number", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const sessionId = onlyRow()!.id;
    foundryStub.verify = {
      status: 200,
      body: { id: "v_phone_1", state: "pending", created_at: 0 },
    };

    await POLL(poll(sessionId));
    expect(phoneOf("user_anna")).toBe("+49 171 5555555");
  });
});

describe("POST /api/profile/phone-change/[sessionId]/apply", () => {
  it("reads the session id from the second-to-last segment", async () => {
    const sessionId = await verifiedSession();
    const response = await APPLY(apply(sessionId));

    expect(response.status).toBe(200);
    expect(onlyRow()?.state).toBe("applied");
  });

  it("answers 200 with the new number", async () => {
    const sessionId = await verifiedSession();
    const response = await APPLY(apply(sessionId));

    expect(await response.json()).toEqual({ phoneNumber: "+49 172 66666666" });
    expect(phoneOf("user_anna")).toBe("+49 172 66666666");
  });

  it("answers 404 for another customer's session", async () => {
    const sessionId = await verifiedSession();
    sessionStub.userId = "user_ben";

    expect((await APPLY(apply(sessionId))).status).toBe(404);
    expect(phoneOf("user_anna")).toBe("+49 171 5555555");
  });

  it("answers 410 for already_applied and for expired", async () => {
    const sessionId = await verifiedSession();
    expect((await APPLY(apply(sessionId))).status).toBe(200);
    // An applied session is gone for good, which is what 410 means.
    expect((await APPLY(apply(sessionId))).status).toBe(410);

    const expired = await verifiedSession();
    db.update(phoneChangeSessions)
      .set({ createdAt: 0 })
      .where(eq(phoneChangeSessions.id, expired))
      .run();
    expect((await APPLY(apply(expired))).status).toBe(410);
  });

  it("answers 409 for not_verified and for phone_changed", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const pending = onlyRow()!.id;
    // A pending session might yet arrive, which is what 409 means.
    expect((await APPLY(apply(pending))).status).toBe(409);

    const sessionId = await verifiedSession();
    db.update(users)
      .set({ phoneNumber: "+49 160 9999999" })
      .where(eq(users.id, "user_anna"))
      .run();
    const response = await APPLY(apply(sessionId));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "phone_changed" });
  });
});

describe("POST /api/profile/phone-change/[sessionId]/dc-api-response", () => {
  it("answers 204 and no body on success", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const sessionId = onlyRow()!.id;
    foundryStub.verify = { status: 200, body: { verified: true, checks: [] } };

    const response = await RELAY(relay(sessionId, { response: "jwe" }));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("answers 400 for a missing response member", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const sessionId = onlyRow()!.id;

    expect((await RELAY(relay(sessionId, {}))).status).toBe(400);
    expect((await RELAY(relay(sessionId, { response: "" }))).status).toBe(400);
  });

  it("answers 502 for foundry_unavailable", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const sessionId = onlyRow()!.id;
    foundryStub.verify = { status: 503, body: {} };

    const response = await RELAY(relay(sessionId, { response: "jwe" }));
    expect(response.status).toBe(502);
  });

  it("answers 404 for another customer's session", async () => {
    await POST(start({ phoneNumber: "+49 172 66666666" }));
    const sessionId = onlyRow()!.id;
    sessionStub.userId = "user_ben";

    const response = await RELAY(relay(sessionId, { response: "jwe" }));
    expect(response.status).toBe(404);
  });
});