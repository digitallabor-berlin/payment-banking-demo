import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import { seed } from "../db/seed.js";
import {
  DPC_CREDENTIAL_TYPE_ID,
  SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
} from "./credential-types.js";
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
  handler: (
    url: string,
    init: RequestInit,
  ) => { status: number; body: unknown },
): FoundryClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const { status, body } = handler(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

const offerOk = () => ({
  status: 200,
  body: {
    transaction_id: "tx_foundry_1",
    credential_offer_uri: "openid-credential-offer://?x=1",
    dc_api_offer: {
      credential_issuer: "https://foundry.example",
      credential_configuration_ids: ["com.emvco.dpc.card"],
    },
  },
});

describe("startIssuance", () => {
  it("creates an offered credential row and returns the offer URI", async () => {
    const result = await startIssuance(
      db,
      stubClient(offerOk),
      "user_anna",
      "card_anna",
      DPC_CREDENTIAL_TYPE_ID,
    );

    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      offerUri: "openid-credential-offer://?x=1",
      dcApiOffer: expect.any(Object),
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

    await startIssuance(db, client, "user_anna", "card_anna", DPC_CREDENTIAL_TYPE_ID);

    expect(sentBody).toMatchObject({
      credential_type_id: "com.emvco.dpc.card",
      claims: { network: "girocard", card_id: "card_anna" },
    });
  });

  it("uses the second card's own network rather than a hardcoded one", async () => {
    let sentBody: unknown = null;
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });

    await startIssuance(db, client, "user_ben", "card_ben", DPC_CREDENTIAL_TYPE_ID);

    expect(sentBody).toMatchObject({
      claims: { network: "girocard", card_id: "card_ben" },
    });
  });

  it("sends both DPC display arrays, with last_four taken from the IBAN", async () => {
    let sentBody: Record<string, unknown> = {};
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });

    await startIssuance(db, client, "user_anna", "card_anna", DPC_CREDENTIAL_TYPE_ID);

    const offerCard = (
      sentBody.offer_display as Array<{ card: Record<string, unknown> }>
    )[0]?.card;
    const responseCard = (
      sentBody.credential_response_display as Array<{
        card: Record<string, unknown>;
      }>
    )[0]?.card;

    // acc_anna's IBAN is DE02120300000000202051 — NOT panLast4, which is 4242.
    expect(responseCard?.last_four).toBe("2051");
    expect(responseCard?.alias).toBe("Girocard");
    expect(responseCard?.card_art).toEqual([
      { theme: "DEFAULT", image_url: "http://localhost:3001/card-face.webp" },
    ]);

    // The offer stage must withhold all three; foundry permits their absence
    // there and the annex's privacy guidance requires it.
    expect(offerCard).not.toHaveProperty("last_four");
    expect(offerCard).not.toHaveProperty("alias");
    expect(offerCard).not.toHaveProperty("card_art");
  });

  it("derives last_four from the second account's IBAN, not the first's", async () => {
    let sentBody: Record<string, unknown> = {};
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });

    await startIssuance(db, client, "user_ben", "card_ben", DPC_CREDENTIAL_TYPE_ID);

    const responseCard = (
      sentBody.credential_response_display as Array<{
        card: Record<string, unknown>;
      }>
    )[0]?.card;
    // acc_ben's IBAN is DE02500105170137075030; panLast4 is 8815.
    expect(responseCard?.last_four).toBe("5030");
    expect(responseCard?.alias).toBe("Kreditkarte");
  });

  it("refuses a card belonging to another user", async () => {
    const result = await startIssuance(
      db,
      stubClient(offerOk),
      "user_ben",
      "card_anna",
      DPC_CREDENTIAL_TYPE_ID,
    );
    expect(result).toEqual({ ok: false, reason: "card_not_found" });
    expect(db.select().from(credentials).all()).toHaveLength(0);
  });

  it("refuses an unknown card id", async () => {
    const result = await startIssuance(
      db,
      stubClient(offerOk),
      "user_anna",
      "card_nope",
      DPC_CREDENTIAL_TYPE_ID,
    );
    expect(result).toEqual({ ok: false, reason: "card_not_found" });
  });

  it("marks the row failed when foundry rejects the offer", async () => {
    const client = stubClient(() => ({ status: 500, body: { error: "boom" } }));

    const result = await startIssuance(db, client, "user_anna", "card_anna", DPC_CREDENTIAL_TYPE_ID);

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = db.select().from(credentials).get();
    // The row is persisted BEFORE foundry is called (spec 6.1 step 3), so the
    // failure is visible rather than silently lost.
    expect(row?.state).toBe("failed");
    expect(row?.foundryTxId).toBeNull();
  });

  it("allows re-issuing the same card, creating a second row", async () => {
    await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna", DPC_CREDENTIAL_TYPE_ID);
    await startIssuance(db, stubClient(offerOk), "user_anna", "card_anna", DPC_CREDENTIAL_TYPE_ID);
    expect(db.select().from(credentials).all()).toHaveLength(2);
  });

  it("returns foundry's dc_api_offer verbatim alongside the deep-link uri", async () => {
    const result = await startIssuance(
      db,
      stubClient(offerOk),
      "user_anna",
      "card_anna",
      DPC_CREDENTIAL_TYPE_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.offerUri).toBe("openid-credential-offer://?x=1");
    expect(result.dcApiOffer).toEqual({
      credential_issuer: "https://foundry.example",
      credential_configuration_ids: ["com.emvco.dpc.card"],
    });
  });

  it("returns an undefined dcApiOffer when foundry omits it", async () => {
    const noDcApi = () => ({
      status: 200,
      body: {
        transaction_id: "tx_1",
        credential_offer_uri: "openid-credential-offer://?x=1",
      },
    });
    const result = await startIssuance(
      db,
      stubClient(noDcApi),
      "user_anna",
      "card_anna",
      DPC_CREDENTIAL_TYPE_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.dcApiOffer).toBeUndefined();
  });
});

describe("startIssuance for the Sparkasse card format", () => {
  async function sentFor(
    userId: string,
    cardId: string,
  ): Promise<Record<string, unknown>> {
    let sentBody: Record<string, unknown> = {};
    const client = stubClient((_url, init) => {
      sentBody = JSON.parse(String(init.body));
      return offerOk();
    });
    await startIssuance(
      db,
      client,
      userId,
      cardId,
      SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
    );
    return sentBody;
  }

  it("asks foundry for the sparkassencard type", async () => {
    const sent = await sentFor("user_anna", "card_anna");
    expect(sent.credential_type_id).toBe("sparkassencard");
  });

  it("sends the sub / masked_iban / psu_id claims its vct declares", async () => {
    const sent = await sentFor("user_anna", "card_anna");
    // acc_anna's IBAN is DE02120300000000202051.
    expect(sent.claims).toEqual({
      sub: expect.any(String),
      masked_iban: "DE** **** 2051",
      psu_id: expect.any(String),
    });
  });

  it("sends NEITHER display array", async () => {
    // foundry gates both on the resolved type's vct and rejects them for
    // anything else, which would land every attempt as a `failed` row rather
    // than as a card missing its artwork.
    const sent = await sentFor("user_anna", "card_anna");
    expect(sent).not.toHaveProperty("offer_display");
    expect(sent).not.toHaveProperty("credential_response_display");
  });

  it("stores the psu_id it sent as the row's join key", async () => {
    const sent = await sentFor("user_anna", "card_anna");
    const row = db.select().from(credentials).get();
    expect(row?.credentialTypeId).toBe("sparkassencard");
    expect(row?.credentialId).toBe(
      (sent.claims as Record<string, string>).psu_id,
    );
  });

  it("mints that join key as a bare UUID, not a dpc_-prefixed value", async () => {
    await sentFor("user_anna", "card_anna");
    const row = db.select().from(credentials).get();
    expect(row?.credentialId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("keeps the card behind the row, so the debit path can resolve an account", async () => {
    await sentFor("user_anna", "card_anna");
    const row = db.select().from(credentials).get();
    expect(row?.cardId).toBe("card_anna");
    expect(row?.state).toBe("offered");
  });

  it("masks the second account's IBAN, not the first's", async () => {
    const sent = await sentFor("user_ben", "card_ben");
    // acc_ben's IBAN is DE02500105170137075030.
    expect((sent.claims as Record<string, string>).masked_iban).toBe(
      "DE** **** 5030",
    );
  });

  it("gives each issuance a fresh sub", async () => {
    const first = await sentFor("user_anna", "card_anna");
    const second = await sentFor("user_anna", "card_anna");
    expect((first.claims as Record<string, string>).sub).not.toBe(
      (second.claims as Record<string, string>).sub,
    );
  });

  it("coexists with a DPC row for the same card", async () => {
    // The two formats are independent credentials for one girocard; neither
    // supersedes the other.
    await startIssuance(
      db,
      stubClient(offerOk),
      "user_anna",
      "card_anna",
      DPC_CREDENTIAL_TYPE_ID,
    );
    await startIssuance(
      db,
      stubClient(offerOk),
      "user_anna",
      "card_anna",
      SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
    );

    const rows = db.select().from(credentials).all();
    expect(rows.map((r) => r.credentialTypeId).sort()).toEqual([
      "com.emvco.dpc.card",
      "sparkassencard",
    ]);
    // Distinct join keys — the UNIQUE index on credential_id depends on it.
    expect(new Set(rows.map((r) => r.credentialId)).size).toBe(2);
  });

  it("marks the row failed when foundry rejects the offer", async () => {
    const client = stubClient(() => ({ status: 500, body: { error: "boom" } }));
    const result = await startIssuance(
      db,
      client,
      "user_anna",
      "card_anna",
      SPARKASSEN_CARD_CREDENTIAL_TYPE_ID,
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    expect(db.select().from(credentials).get()?.state).toBe("failed");
  });
});

describe("refreshIssuanceState", () => {
  async function seedOffered(): Promise<string> {
    const started = await startIssuance(
      db,
      stubClient(offerOk),
      "user_anna",
      "card_anna",
      DPC_CREDENTIAL_TYPE_ID,
    );
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

    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, sessionId))
      .get();
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
    const first = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, sessionId))
      .get();
    await refreshIssuanceState(db, client, "user_anna", sessionId);
    const second = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, sessionId))
      .get();

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

    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, sessionId))
      .get();
    expect(row?.state).toBe("offered");
  });
});
