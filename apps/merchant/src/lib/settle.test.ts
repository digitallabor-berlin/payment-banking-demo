import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orderItems, orders, paymentSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { BankClient } from "./bank.js";
import {
  refreshPaymentSessionState,
  startPaymentSession,
} from "./payment-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-settle-"));
  db = createDb(path.join(dir, "test.db"));
  // order_items references products, so the catalogue has to exist.
  seed(db);
  db.insert(orders)
    .values({
      id: "ord_1",
      totalCents: 4_798,
      currency: "EUR",
      customerName: "Ada",
      customerEmail: "ada@example.com",
      status: "pending",
      createdAt: 1,
    })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function stubFoundry(body: unknown, status = 200): FoundryClient {
  const fetchImpl = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

/** foundry's create-verification response, used to seed a session. */
const createOk = {
  verification_id: "ver_1",
  openid4vp_uri: "openid4vp://?x=1",
  request_uri: "https://f/req/1",
};

/** The payment credential, verified and bound to the amount. */
const dpcCredential = {
  query_id: "dpc",
  format: "dc+sd-jwt",
  claims: { credential_id: "dpc_abc", network: "girocard" },
  checks: [
    { check: "sd_jwt_vc_signature_and_kb_jwt", passed: true },
    { check: "dcql_match", passed: true },
    { check: "transaction_data_binding", passed: true },
  ],
};

/** The EU Proof of Age attestation, disclosing age_over_18 under its namespace. */
const avCredential = {
  query_id: "av",
  format: "mso_mdoc",
  claims: { "eu.europa.ec.av.1": { age_over_18: true } },
  checks: [
    { check: "mdoc_issuer_auth_and_device_signature", passed: true },
    { check: "dcql_match", passed: true },
  ],
};

/**
 * foundry's verdict in the shape it is actually served: cross-cutting checks at
 * the top level, everything else attributed to the credential that reported it.
 */
function verdict(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver_1",
    state: "verified",
    created_at: 1,
    result: {
      verified: true,
      checks: [{ check: "jwe_decryption", passed: true }],
      credentials: [dpcCredential],
    },
    ...overrides,
  };
}

function stubBank(
  result: Awaited<ReturnType<BankClient["pay"]>>,
  spy?: (input: unknown) => void,
) {
  return {
    pay: vi.fn(async (input: unknown) => {
      spy?.(input);
      return result;
    }),
  } as unknown as BankClient;
}

/**
 * Starts a session for ord_1. Pass product ids to give the order a basket —
 * an age-restricted one makes the session a `dpc_av` session, which is what
 * arms the age gate.
 */
async function seedSession(...productIds: string[]): Promise<string> {
  for (const productId of productIds) {
    db.insert(orderItems)
      .values({ orderId: "ord_1", productId, quantity: 1, unitPriceCents: 100 })
      .run();
  }

  const started = await startPaymentSession(
    db,
    stubFoundry(createOk),
    "ord_1",
    "Demo Shop",
    "Payee-id-123",
  );
  if (!started.ok) throw new Error("setup failed");
  return started.sessionId;
}

describe("refreshPaymentSessionState — verification phase", () => {
  it("stays pending while foundry is still waiting for the wallet", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry({ id: "ver_1", state: "pending", created_at: 1 }),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("fails the session when foundry reports the presentation failed", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry({
        id: "ver_1",
        state: "failed",
        created_at: 1,
        result: null,
      }),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );
    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("fails the session when verified is false even if state says verified", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(
        verdict({ result: { verified: false, checks: [], credentials: [] } }),
      ),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );
    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
  });

  it("refuses to settle when transaction_data_binding did not pass", async () => {
    const sessionId = await seedSession();
    const bank = stubBank({ ok: true, bankTxId: "tx_1" });
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(
        verdict({
          result: {
            verified: true,
            checks: [],
            credentials: [
              {
                ...dpcCredential,
                checks: [
                  { check: "dcql_match", passed: true },
                  { check: "transaction_data_binding", passed: false },
                ],
              },
            ],
          },
        }),
      ),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: {
        state: "failed",
        failureReason: "transaction_data_binding_failed",
      },
    });
    // The gate must stop the money moving, not merely label the session.
    expect(bank.pay).not.toHaveBeenCalled();
  });

  it("fails when the verdict carries no credential_id to settle against", async () => {
    const sessionId = await seedSession();
    const bank = stubBank({ ok: true, bankTxId: "tx_1" });
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(
        verdict({
          result: {
            verified: true,
            checks: [],
            credentials: [
              { ...dpcCredential, claims: { network: "girocard" } },
            ],
          },
        }),
      ),
      bank,
      sessionId,
    );
    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "verification_failed" },
    });
    expect(bank.pay).not.toHaveBeenCalled();
  });

  it("records both the cross-cutting and the per-credential checks for display", async () => {
    const sessionId = await seedSession("cheese");
    await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );

    const stored = JSON.parse(
      db
        .select()
        .from(paymentSessions)
        .where(eq(paymentSessions.id, sessionId))
        .get()?.checksJson ?? "[]",
    ) as Array<{ check: string }>;

    expect(stored.map((entry) => entry.check)).toEqual([
      "jwe_decryption",
      "sd_jwt_vc_signature_and_kb_jwt",
      "dcql_match",
      "transaction_data_binding",
    ]);
  });
});

describe("refreshPaymentSessionState — age gate", () => {
  it("settles an age-restricted basket when age_over_18 is disclosed as true", async () => {
    const sessionId = await seedSession("beer");
    const bank = stubBank({ ok: true, bankTxId: "tx_av" });

    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(
        verdict({
          result: {
            verified: true,
            checks: [],
            credentials: [dpcCredential, avCredential],
          },
        }),
      ),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });
    expect(bank.pay).toHaveBeenCalledTimes(1);
  });

  it("refuses to settle when the wallet returned no age attestation", async () => {
    // Requesting age_over_18 and then paying anyway would make the escalation
    // decorative. Absence fails closed, like the binding check.
    const sessionId = await seedSession("wine");
    const bank = stubBank({ ok: true, bankTxId: "tx_av" });

    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "age_verification_failed" },
    });
    expect(bank.pay).not.toHaveBeenCalled();
  });

  it("refuses to settle when the holder is not old enough", async () => {
    const sessionId = await seedSession("aperitif");
    const bank = stubBank({ ok: true, bankTxId: "tx_av" });

    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(
        verdict({
          result: {
            verified: true,
            checks: [],
            credentials: [
              dpcCredential,
              {
                ...avCredential,
                claims: { "eu.europa.ec.av.1": { age_over_18: false } },
              },
            ],
          },
        }),
      ),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "age_verification_failed" },
    });
    expect(bank.pay).not.toHaveBeenCalled();
  });

  it("does not demand an age attestation for an ordinary basket", async () => {
    // The gate is armed by what the session ASKED for, not by what came back —
    // otherwise every `dpc` payment would fail for want of an `av` credential.
    const sessionId = await seedSession("cheese");
    const bank = stubBank({ ok: true, bankTxId: "tx_plain" });

    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });
  });

  it("applies the gate the session recorded, not one re-derived from the order", async () => {
    // A session started for a plain basket stays a `dpc` session even if the
    // order is edited afterwards. Re-deriving here would flip the verdict
    // mid-flight against a presentation the wallet already answered.
    const sessionId = await seedSession("cheese");
    db.insert(orderItems)
      .values({
        orderId: "ord_1",
        productId: "beer",
        quantity: 1,
        unitPriceCents: 179,
      })
      .run();

    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      sessionId,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });
  });
});

describe("refreshPaymentSessionState — settlement phase", () => {
  it("debits the bank and completes the session and order", async () => {
    const sessionId = await seedSession();
    let sent: unknown = null;
    const bank = stubBank({ ok: true, bankTxId: "tx_bank_1" }, (input) => {
      sent = input;
    });

    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });

    const session = db
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.id, sessionId))
      .get();
    expect(session?.state).toBe("completed");
    expect(session?.bankTxId).toBe("tx_bank_1");

    const order = db.select().from(orders).where(eq(orders.id, "ord_1")).get();
    expect(order?.status).toBe("paid");

    // The amount is the order's server-side total, and the idempotency key is
    // the session id (spec §6.2).
    expect(sent).toMatchObject({
      credentialId: "dpc_abc",
      amountCents: 4_798,
      currency: "EUR",
      idempotencyKey: sessionId,
    });
  });

  it("maps insufficient funds to a failed session and leaves the order pending", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: false, reason: "insufficient_funds" }),
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "insufficient_funds" },
    });
    const order = db.select().from(orders).where(eq(orders.id, "ord_1")).get();
    expect(order?.status).toBe("pending");
  });

  it("maps an unreachable bank to a failed session, order still pending and retryable", async () => {
    const sessionId = await seedSession();
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: false, reason: "bank_unreachable" }),
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "bank_unreachable" },
    });
    const order = db.select().from(orders).where(eq(orders.id, "ord_1")).get();
    expect(order?.status).toBe("pending");
  });

  it("does not call foundry or the bank again once completed", async () => {
    const sessionId = await seedSession();
    const bank = stubBank({ ok: true, bankTxId: "tx_bank_1" });
    await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      bank,
      sessionId,
    );

    const callsAfterFirst = (
      bank.pay as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length;
    const second = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      bank,
      sessionId,
    );

    expect(second).toMatchObject({ ok: true, status: { state: "completed" } });
    expect(
      (bank.pay as unknown as { mock: { calls: unknown[] } }).mock.calls.length,
    ).toBe(callsAfterFirst);
  });

  it("resumes a session left in 'verified' by an interrupted earlier poll", async () => {
    const sessionId = await seedSession();
    // Simulate a process that passed the gate and stored the claims, then
    // stopped before calling the bank.
    db.update(paymentSessions)
      .set({
        state: "verified",
        disclosedClaimsJson: JSON.stringify([dpcCredential]),
      })
      .where(eq(paymentSessions.id, sessionId))
      .run();

    const bank = stubBank({ ok: true, bankTxId: "tx_resumed" });
    // foundry deliberately still reports 'pending' here: if the resume path
    // re-polled instead of reading the stored claims, this would stall rather
    // than settle, so the assertion below pins that it does not re-poll.
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry({ id: "ver_1", state: "pending", created_at: 1 }),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });
    expect(bank.pay).toHaveBeenCalledTimes(1);
  });

  it("returns not_found for an unknown session id", async () => {
    const result = await refreshPaymentSessionState(
      db,
      stubFoundry(verdict()),
      stubBank({ ok: true, bankTxId: "tx_1" }),
      "sess_nope",
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});
