import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { startAuthenticatorIssuance } from "./authenticator-issuance.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "./credential-types.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-auth-"));
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

const OFFER_OK = {
  status: 200,
  body: {
    transaction_id: "tx_auth_1",
    credential_offer_uri: "openid-credential-offer://?auth=1",
    dc_api_offer: {
      credential_issuer: "https://foundry.example",
      credential_configuration_ids: [SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID],
    },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("startAuthenticatorIssuance", () => {
  it("returns the offer URI and the DC API rendering of the same offer", async () => {
    const result = await startAuthenticatorIssuance(
      db,
      stubClient([], OFFER_OK),
      "user_anna",
    );
    expect(result).toEqual({
      ok: true,
      sessionId: expect.any(String),
      offerUri: "openid-credential-offer://?auth=1",
      dcApiOffer: expect.any(Object),
    });
  });

  it("asks foundry for the sparkassen_auth credential type", async () => {
    const captures: Capture[] = [];
    await startAuthenticatorIssuance(
      db,
      stubClient(captures, OFFER_OK),
      "user_anna",
    );
    expect(captures).toHaveLength(1);
    expect(captures[0]?.body.credential_type_id).toBe("sparkassen_auth");
  });

  it("sends exactly one claim, a `sub` UUID, and nothing else", async () => {
    // The whole claim set. An authenticator that also disclosed a name, an
    // IBAN or a customer number would attest more than it is for.
    const captures: Capture[] = [];
    await startAuthenticatorIssuance(
      db,
      stubClient(captures, OFFER_OK),
      "user_anna",
    );
    const claims = captures[0]?.body.claims as Record<string, unknown>;
    expect(Object.keys(claims)).toEqual(["sub"]);
    expect(claims.sub).toMatch(UUID);
  });

  it("mints a fresh sub per issuance, so two credentials cannot be correlated", async () => {
    const captures: Capture[] = [];
    const client = stubClient(captures, OFFER_OK);
    await startAuthenticatorIssuance(db, client, "user_anna");
    await startAuthenticatorIssuance(db, client, "user_anna");
    expect(captures).toHaveLength(2);
    expect(captures[0]?.body.claims).not.toEqual(captures[1]?.body.claims);
  });

  it("persists the sub it sent, and nothing else from the claims", async () => {
    // `sub` used to be sent and forgotten. Wallet login is what changed that:
    // a presentation discloses this value and nothing else identifying, so it
    // is the only way back from a vp_token to a customer. It lands in
    // `credential_id` and nowhere else on the row.
    const captures: Capture[] = [];
    const result = await startAuthenticatorIssuance(
      db,
      stubClient(captures, OFFER_OK),
      "user_anna",
    );
    if (!result.ok) throw new Error("expected the offer to succeed");
    const claims = captures[0]?.body.claims as Record<string, unknown>;
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, result.sessionId))
      .get();
    expect(row?.credentialId).toBe(String(claims.sub));
    expect(Object.keys(claims)).toEqual(["sub"]);
  });

  it("sends no display metadata at all", async () => {
    // foundry gates both display fields on the DPC's vct (create_offer.rs) and
    // rejects them outright for anything else, which lands as a `failed` row
    // rather than a credential missing its artwork. Their absence is a
    // requirement, not a tidiness point.
    const captures: Capture[] = [];
    await startAuthenticatorIssuance(
      db,
      stubClient(captures, OFFER_OK),
      "user_anna",
    );
    expect(captures[0]?.body).not.toHaveProperty("offer_display");
    expect(captures[0]?.body).not.toHaveProperty("credential_response_display");
  });

  it("writes an offered row with no card, keyed by the subject", async () => {
    const result = await startAuthenticatorIssuance(
      db,
      stubClient([], OFFER_OK),
      "user_anna",
    );
    if (!result.ok) throw new Error("expected the offer to succeed");
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, result.sessionId))
      .get();
    expect(row?.userId).toBe("user_anna");
    // No card: this credential attests a property of the person, and it is not
    // payable, so there is nothing for `processPayment` to debit through.
    expect(row?.cardId).toBeNull();
    // `credential_id` here is the authentication subject, NOT a payment join
    // key. `isPaymentCredentialType` is what stops it authorizing a debit —
    // see the guard proved in payments.test.ts.
    expect(row?.credentialId).toEqual(expect.any(String));
    expect(row?.credentialTypeId).toBe("sparkassen_auth");
    expect(row?.state).toBe("offered");
    expect(row?.issuedAt).toBeNull();
  });

  it("stores foundry's transaction id on the row", async () => {
    const result = await startAuthenticatorIssuance(
      db,
      stubClient([], OFFER_OK),
      "user_anna",
    );
    if (!result.ok) throw new Error("expected the offer to succeed");
    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.id, result.sessionId))
      .get();
    expect(row?.foundryTxId).toBe("tx_auth_1");
  });

  it("leaves a failed row when foundry rejects the offer", async () => {
    // The state every foundry config there is produces today: `sparkassen_auth`
    // is declared by none of them, so this is the path a real click takes until
    // an operator declares the type.
    const result = await startAuthenticatorIssuance(
      db,
      stubClient([], {
        status: 400,
        body: { error: "unknown credential_type_id 'sparkassen_auth'" },
      }),
      "user_anna",
    );
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const rows = db.select().from(credentials).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]?.credentialTypeId).toBe("sparkassen_auth");
    expect(rows[0]?.foundryTxId).toBeNull();
  });

  it("records the attempt before calling foundry, so an outage is visible", async () => {
    // The row is written first on purpose. A foundry that never answers must
    // leave a `failed` row the user can see rather than no trace at all.
    const rejecting = new FoundryClient({
      adminUrl: "http://f:9000",
      adminKey: "k",
      fetchImpl: (async () => {
        throw new Error("connection refused");
      }) as unknown as typeof fetch,
    });
    const result = await startAuthenticatorIssuance(db, rejecting, "user_anna");
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const rows = db.select().from(credentials).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("failed");
  });

  it("writes one row per issuance, so a re-add does not overwrite its predecessor", async () => {
    const client = stubClient([], OFFER_OK);
    const first = await startAuthenticatorIssuance(db, client, "user_anna");
    const second = await startAuthenticatorIssuance(db, client, "user_anna");
    if (!first.ok || !second.ok) throw new Error("expected both to succeed");
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(db.select().from(credentials).all()).toHaveLength(2);
  });
});

describe("persisting the subject", () => {
  it("stores the sub it sent, so a presentation can be resolved to a user", async () => {
    const captures: Capture[] = [];
    const client = stubClient(captures, OFFER_OK);

    const result = await startAuthenticatorIssuance(db, client, "user_anna");
    expect(result.ok).toBe(true);

    const row = db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID))
      .get();

    const sent = (captures[0]?.body["claims"] as Record<string, unknown>)["sub"];
    expect(typeof sent).toBe("string");
    expect(row?.credentialId).toBe(sent);
  });

  it("mints a different sub per issuance, so two are not correlatable", async () => {
    const captures: Capture[] = [];
    const client = stubClient(captures, OFFER_OK);

    await startAuthenticatorIssuance(db, client, "user_anna");
    await startAuthenticatorIssuance(db, client, "user_anna");

    const rows = db
      .select()
      .from(credentials)
      .where(eq(credentials.credentialTypeId, SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID))
      .all();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.credentialId).not.toBe(rows[1]?.credentialId);
    expect(rows[0]?.credentialId).not.toBeNull();
  });
});
