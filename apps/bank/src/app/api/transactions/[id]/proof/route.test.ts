/**
 * The wire body of `GET /api/transactions/{id}/proof`.
 *
 * The exact-key-set assertion below is the point of this file. A route body is
 * a hand-maintained projection, and this repo has already shipped one bug where
 * a member existed everywhere except the `NextResponse.json` literal —
 * `dcApiProtocol`, fixed in 6e997da. A type cannot catch it, because
 * `JSON.stringify` silently drops `undefined`. Only parsing the response can.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/db/index.js";
import { transactionProofs } from "@/db/schema.js";
import { seed } from "@/db/seed.js";
import { listTransactions } from "@/lib/queries.js";

const dbStub = vi.hoisted(() => ({ db: null as unknown }));
const sessionStub = vi.hoisted(() => ({ userId: "user_anna" }));

vi.mock("@/db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/db/index.js")>()),
  getDb: () => dbStub.db,
}));

// withSession's guard is exercised by session.test.ts; this file is about the
// body's shape, so the session is supplied rather than minted.
vi.mock("@/lib/session.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session.js")>()),
  requireSession: async () => ({
    userId: sessionStub.userId,
    displayName: "Anna",
  }),
}));

const { GET } = await import("./route.js");

let db: Db;
let txId: string;

beforeEach(() => {
  db = createDb(":memory:");
  dbStub.db = db;
  seed(db);
  sessionStub.userId = "user_anna";
  txId = listTransactions(db, "user_anna", 20, 0)[0]!.id;
});

function get(id: string): Request {
  return new Request(`http://b/api/transactions/${id}/proof`);
}

describe("GET /api/transactions/[id]/proof", () => {
  it("returns exactly the members the viewer reads", async () => {
    db.insert(transactionProofs)
      .values({
        transactionId: txId,
        signedRequest: "a.b.c",
        vpTokenJson: '{"dpc":["x"]}',
        receivedAt: 7,
      })
      .run();

    const response = await GET(get(txId));
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    // Exact, not a subset: the defect this guards against is an ABSENT member.
    expect(Object.keys(body).sort()).toEqual(["proofPackage", "receivedAt"]);
    expect(Object.keys(body.proofPackage as object).sort()).toEqual([
      "signed_request",
      "vp_token",
    ]);
    expect(body.proofPackage).toEqual({
      signed_request: "a.b.c",
      vp_token: { dpc: ["x"] },
    });
    expect(body.receivedAt).toBe(7);
  });

  it("404s a transaction with no package", async () => {
    const response = await GET(get(txId));
    expect(response.status).toBe(404);
  });

  it("404s a transaction owned by someone else", async () => {
    db.insert(transactionProofs)
      .values({
        transactionId: txId,
        signedRequest: "a.b.c",
        vpTokenJson: "{}",
        receivedAt: 7,
      })
      .run();
    sessionStub.userId = "user_ben";

    const response = await GET(get(txId));
    expect(response.status).toBe(404);
  });

  it("404s an id that does not exist", async () => {
    const response = await GET(get("tx_nope"));
    expect(response.status).toBe(404);
  });
});