import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { startAvIssuance } from "./av-issuance.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-av-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** One recorded admin-API call, so a test can assert on the exact payload. */
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

const offerOk = {
  status: 200,
  body: {
    transaction_id: "tx_av_1",
    credential_offer_uri: "openid-credential-offer://?av=1",
    dc_api_offer: {
      credential_issuer: "https://foundry.example",
      credential_configuration_ids: ["av-sparkasse"],
    },
  },
};

describe("startAvIssuance", () => {
  it("returns the offer URI and the DC API rendering of the same offer", async () => {
    const result = await startAvIssuance(db, stubClient([], offerOk), "user_anna");
    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      offerUri: "openid-credential-offer://?av=1",
      dcApiOffer: expect.any(Object),
    });
  });

  it("asks foundry for credential_type_id 'av-sparkasse'", async () => {
    const captures: Capture[] = [];
    await startAvIssuance(db, stubClient(captures, offerOk), "user_anna");
    expect(captures).toHaveLength(1);
    expect(captures[0]?.body.credential_type_id).toBe("av-sparkasse");
  });

  it("sends exactly the two age booleans and nothing else", async () => {
    const captures: Capture[] = [];
    await startAvIssuance(db, stubClient(captures, offerOk), "user_anna");
    expect(captures[0]?.body.claims).toEqual({
      age_over_16: true,
      age_over_18: true,
    });
  });

  it("sends no display metadata at all", async () => {
    // foundry rejects both display fields for any type whose vct is not the
    // DPC's (create_offer.rs). Sending them would turn every AV issuance into
    // a failed row, so their absence is a requirement, not a tidiness point.
    const captures: Capture[] = [];
    await startAvIssuance(db, stubClient(captures, offerOk), "user_anna");
    expect(captures[0]?.body).not.toHaveProperty("offer_display");
    expect(captures[0]?.body).not.toHaveProperty("credential_response_display");
  });

  it("writes an offered row with no card, no join key, and the av type", async () => {
    const result = await startAvIssuance(db, stubClient([], offerOk), "user_anna");
    if (!result.ok) throw new Error("expected the offer to succeed");
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, result.sessionId))
      .get();
    expect(row?.userId).toBe("user_anna");
    expect(row?.cardId).toBeNull();
    expect(row?.credentialId).toBeNull();
    expect(row?.credentialTypeId).toBe("av-sparkasse");
    expect(row?.state).toBe("offered");
    expect(row?.issuedAt).toBeNull();
  });

  it("stores foundry's transaction id on the row", async () => {
    const result = await startAvIssuance(db, stubClient([], offerOk), "user_anna");
    if (!result.ok) throw new Error("expected the offer to succeed");
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, result.sessionId))
      .get();
    expect(row?.foundryTxId).toBe("tx_av_1");
  });

  it("leaves a failed row when foundry rejects the offer", async () => {
    // The state a foundry with no `av-sparkasse` credential type configured produces.
    const result = await startAvIssuance(
      db,
      stubClient([], { status: 400, body: { error: "unknown_credential_type" } }),
      "user_anna",
    );
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const rows = db.select().from(credentials).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]?.foundryTxId).toBeNull();
  });
});