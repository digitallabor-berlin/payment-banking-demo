import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { refreshIssuanceState, startIssuance } from "./issuance.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-iss-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A FoundryClient whose HTTP layer is replaced by a scripted stub. */
function stubClient(
  handler: (url: string, init: RequestInit) => { status: number; body: unknown },
): FoundryClient {
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

const offerOk = () => ({
  status: 200,
  body: {
    transaction_id: "tx_foundry_1",
    credential_offer_uri: "openid-credential-offer://?x=1",
    dc_api_offer: {},
  },
});

describe("startIssuance", () => {
  it("creates an offered credential row and returns the offer URI", async () => {
    const result = await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");

    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      offerUri: "openid-credential-offer://?x=1",
    });

    const row = db.select().from(credentials).get();
    expect(row?.state).toBe("offered");
    expect(row?.cardId).toBe("card_anna");
    expect(row?.userId).toBe("user_anna");
    expect(row?.foundryTxId).toBe("tx_foundry_1");
    expect(row?.issuedAt).toBeNull();
    expect(row?.credentialId).toMatch(/^dpc_[A-Za-z0-9_-]{24}$/);
  });

  it("sends the DPC type and the card's own network as claims", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });

    await startIssuance(db, client, "user_anna", "card_anna");

    expect(sentBody).toMatchObject({
      credential_type_id: "com.emvco.dpc.card",
      claims: { network: "VISA", card_id: "card_anna" },
    });
  });

  it("uses the second card's own network rather than a hardcoded one", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });

    await startIssuance(db, client, "user_ben", "card_ben");

    expect(sentBody).toMatchObject({ claims: { network: "Mastercard" } });
  });

  it("refuses a card belonging to another user", async () => {
    const result = await startIssuance(db, stubClient(offerOk), "user_ben", "card_anna");
    expect(result).toEqual({ ok: false, reason: "card_not_found" });
    expect(db.select().from(credentials).all()).toHaveLength(0);
  });

  it("refuses an unknown card id", async () => {
    const result = await startIssuance(db, stubClient(offerOk), "user_anna", "card_nope");
    expect(result).toEqual({ ok: false, reason: "card_not_found" });
  });

  it("marks the row failed when foundry rejects the offer", async () => {
    const client = stubClient(() => ({ status: 500, body: { error: "boom" } }));

    const result = await startIssuance(db, client, "user_anna", "card_anna");

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(credentials).get();
    // The row is persisted BEFORE foundry is called (spec 6.1 step 3), so the
    // failure is visible rather than silently lost.
    expect(row?.state).toBe("failed");
    expect(row?.foundryTxId).toBeNull();
  });

  it("allows re-issuing the same card, creating a second row", async () => {
    await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");
    await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");
    expect(db.select().from(credentials).all()).toHaveLength(2);
  });
});

describe("refreshIssuanceState", () => {
  async function seedOffered(): Promise<string> {
    const started = await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna");
    if (!started.ok) throw new Error("setup failed");
    return started.sessionId;
  }

  it("stays offered while foundry still reports offered", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({
      status: 200,
      body: {
        transaction_id: "tx_foundry_1",
        credential_type_id: "com.emvco.dpc.card",
        state: "offered",
        created_at: 1,
      },
    }));

    await expect(
      refreshIssuanceState(db, client, "user_anna", sessionId),
    ).resolves.toEqual({ ok: true, state: "offered" });
  });

  it("promotes to active and stamps issuedAt once foundry reports issued", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({
      status: 200,
      body: {
        transaction_id: "tx_foundry_1",
        credential_type_id: "com.emvco.dpc.card",
        state: "issued",
        created_at: 1,
      },
    }));

    await expect(
      refreshIssuanceState(db, client, "user_anna", sessionId),
    ).resolves.toEqual({ ok: true, state: "active" });

    const row = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();
    expect(row?.state).toBe("active");
    expect(row?.issuedAt).toBeTypeOf("number");
  });

  it("is idempotent — a second poll after issuance stays active", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({
      status: 200,
      body: {
        transaction_id: "tx_foundry_1",
        credential_type_id: "com.emvco.dpc.card",
        state: "issued",
        created_at: 1,
      },
    }));

    await refreshIssuanceState(db, client, "user_anna", sessionId);
    const first = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();
    await refreshIssuanceState(db, client, "user_anna", sessionId);
    const second = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();

    expect(second?.state).toBe("active");
    expect(second?.issuedAt).toBe(first?.issuedAt);
  });

  it("does not call foundry again once the row is already active", async () => {
    const sessionId = await seedOffered();
    let calls = 0;
    const issued = stubClient(() => {
      calls++;
      return {
        status: 200,
        body: {
          transaction_id: "tx_foundry_1",
          credential_type_id: "com.emvco.dpc.card",
          state: "issued",
          created_at: 1,
        },
      };
    });

    await refreshIssuanceState(db, issued, "user_anna", sessionId);
    const afterFirst = calls;
    await refreshIssuanceState(db, issued, "user_anna", sessionId);

    expect(calls).toBe(afterFirst);
  });

  it("refuses another user's credential row", async () => {
    const sessionId = await seedOffered();
    await expect(
      refreshIssuanceState(db, stubClient(offerOk), "user_ben", sessionId),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_found for an unknown row", async () => {
    await expect(
      refreshIssuanceState(db, stubClient(offerOk), "user_anna", "cred_nope"),
    ).resolves.toEqual({ ok: false, reason: "not_found" });
  });

  it("keeps the row offered when foundry is unreachable, so polling can recover", async () => {
    const sessionId = await seedOffered();
    const client = stubClient(() => ({ status: 503, body: { error: "down" } }));

    await expect(
      refreshIssuanceState(db, client, "user_anna", sessionId),
    ).resolves.toEqual({ ok: true, state: "offered" });

    const row = db.select().from(credentials).where(eq(credentials.id, sessionId)).get();
    expect(row?.state).toBe("offered");
  });
});