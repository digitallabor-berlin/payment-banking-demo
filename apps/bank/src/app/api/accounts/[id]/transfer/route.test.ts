/**
 * The wire contract of the transfer start route.
 *
 * The exact-key-set assertion below is the point of the first describe. A
 * route body is a hand-maintained projection, and this repo has already
 * shipped one bug where a member existed everywhere except the
 * `NextResponse.json` literal — `dcApiProtocol`, fixed in 6e997da. A type
 * cannot catch it, because `JSON.stringify` silently drops `undefined`. Only
 * parsing the response can.
 *
 * The rest is about the two things a route owns that a lib function cannot:
 * the status-code mapping, and reading a dynamic segment off a URL without
 * throwing on one it did not anticipate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/index.js";
import { accounts, transferSessions } from "@/db/schema.js";
import { seed } from "@/db/seed.js";
import { eq } from "drizzle-orm";

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
// the handler does with a session, so the session is supplied rather than minted.
vi.mock("@/lib/session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session.js")>()),
  requireSession: async () => ({
    userId: sessionStub.userId,
    displayName: "Anna",
  }),
}));

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

const MINT_OK = { status: 200, body: { jwt: "a.b.c", exp: 1792427805 } };
const REQUEST_URI_OK = {
  status: 200,
  body: {
    verification_id: "v_transfer_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};
const DC_API_SIGNED_OK = {
  status: 200,
  body: {
    verification_id: "v_transfer_2",
    dc_api_request: { request: "eyJ0.eyJ1.sig" },
    protocol: "openid4vp-v1-signed",
  },
};

/** A complete, valid request body. */
const VALID = {
  payeeName: "Max Mustermann",
  payeeIban: "DE89370400440532013000",
  amount: "250.00",
  purpose: "Rent October",
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
  return new Request(`http://b/api/accounts/${accountId}/transfer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function onlyRow() {
  return db.select().from(transferSessions).get();
}

function setMoney(limitCents: number, balanceCents: number) {
  db.update(accounts)
    .set({ dailyLimitCents: limitCents, balanceCents })
    .where(eq(accounts.id, "acc_anna"))
    .run();
}

describe("POST /api/accounts/[id]/transfer", () => {
  it("answers 201 with the session DTO", async () => {
    const response = await POST(start("acc_anna", VALID));
    expect(response.status).toBe(201);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body.state).toBe("pending");
    expect(body.amountCents).toBe(25_000);
  });

  it("returns EXACTLY the DTO's keys", async () => {
    const response = await POST(start("acc_anna", VALID));
    const body = (await response.json()) as Record<string, unknown>;

    // Exact, not a subset: the defect this guards against is an ABSENT member,
    // and `JSON.stringify` drops an undefined one without a word.
    expect(Object.keys(body).sort()).toEqual([
      "accountId",
      "amountCents",
      "dcApiProtocol",
      "dcApiRequest",
      "payeeIban",
      "payeeName",
      "purpose",
      "sessionId",
      "state",
      "transport",
      "uri",
    ]);
  });

  it("agrees member for member with the row it wrote", async () => {
    foundryStub.verify = DC_API_SIGNED_OK;
    const response = await POST(
      start("acc_anna", { ...VALID, transport: "dc_api_signed" }),
    );
    const body = (await response.json()) as Record<string, unknown>;
    const row = onlyRow()!;

    expect(body.sessionId).toBe(row.id);
    expect(body.accountId).toBe(row.accountId);
    expect(body.transport).toBe(row.transport);
    expect(body.payeeName).toBe(row.payeeName);
    expect(body.payeeIban).toBe(row.payeeIban);
    expect(body.amountCents).toBe(row.amountCents);
    expect(body.purpose).toBe(row.purpose);
    expect(body.state).toBe(row.state);
    // The member this repo lost at exactly this seam once already.
    expect(body.dcApiProtocol).toBe(row.dcApiProtocol);
    expect(JSON.stringify(body.dcApiRequest)).toBe(row.dcApiRequestJson);
  });

  it("defaults to the cross-device transport when none is named", async () => {
    const response = await POST(start("acc_anna", VALID));
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.transport).toBe("request_uri");
    expect(body.dcApiProtocol).toBeNull();
    expect(body.dcApiRequest).toBeNull();
  });

  it("answers 400 for an unparseable body", async () => {
    const response = await POST(start("acc_anna", "not json at all"));
    expect(response.status).toBe(400);
    expect(foundryStub.calls).toHaveLength(0);
  });

  it("answers 400 for a body missing a field", async () => {
    // zod checks the WIRE SHAPE. `validateTransferInput` checks the meaning.
    const { purpose: _dropped, ...incomplete } = VALID;
    const response = await POST(start("acc_anna", incomplete));
    expect(response.status).toBe(400);
    expect(foundryStub.calls).toHaveLength(0);
  });

  it("answers 400 for invalid_request", async () => {
    for (const bad of [
      { ...VALID, amount: "1.250,00" },
      { ...VALID, payeeIban: "DE89370400440532013100" },
      { ...VALID, payeeName: "   " },
      { ...VALID, purpose: "" },
    ]) {
      const response = await POST(start("acc_anna", bad));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_request");
    }
    expect(foundryStub.calls).toHaveLength(0);
  });

  it("answers 409 for limit_exceeded and for insufficient_funds", async () => {
    // A conflict with the account's current state, which would succeed again
    // if that state changed — which is exactly what a 409 means.
    const overLimit = await POST(start("acc_anna", { ...VALID, amount: "1000.01" }));
    expect(overLimit.status).toBe(409);
    expect((await overLimit.json()).error).toBe("limit_exceeded");

    setMoney(1_000_000, 10_000);
    const overBalance = await POST(start("acc_anna", VALID));
    expect(overBalance.status).toBe(409);
    expect((await overBalance.json()).error).toBe("insufficient_funds");
  });

  it("answers 404 for not_found", async () => {
    // Another customer's account and a nonexistent one are indistinguishable.
    const other = await POST(start("acc_ben", VALID));
    expect(other.status).toBe(404);

    const nobody = await POST(start("acc_nobody", VALID));
    expect(nobody.status).toBe(404);
  });

  it("answers 502 for metadata_unavailable and foundry_unavailable", async () => {
    foundryStub.mint = { status: 500, body: { error: "nope" } };
    const mintFailed = await POST(start("acc_anna", VALID));
    expect(mintFailed.status).toBe(502);
    expect((await mintFailed.json()).error).toBe("metadata_unavailable");

    foundryStub.mint = MINT_OK;
    foundryStub.verify = { status: 503, body: { error: "down" } };
    const verifyFailed = await POST(start("acc_anna", VALID));
    expect(verifyFailed.status).toBe(502);
    expect((await verifyFailed.json()).error).toBe("foundry_unavailable");
  });
});