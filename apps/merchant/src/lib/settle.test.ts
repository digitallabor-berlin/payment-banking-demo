import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import { BankClient } from "./bank.js";
import { refreshPaymentSessionState, startPaymentSession } from "./payment-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "merchant-settle-"));
  db = createDb(path.join(dir, "test.db"));
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
  return new FoundryClient({ adminUrl: "http://f:9000", adminKey: "k", fetchImpl });
}

/** foundry's create-verification response, used to seed a session. */
const createOk = {
  verification_id: "ver_1",
  openid4vp_uri: "openid4vp://?x=1",
  request_uri: "https://f/req/1",
};

function verdict(overrides: Record<string, unknown> = {}) {
  return {
    id: "ver_1",
    state: "verified",
    created_at: 1,
    result: {
      verified: true,
      checks: [
        { check: "sd_jwt_vc_signature_and_kb_jwt", passed: true },
        { check: "dcql_match", passed: true },
        { check: "transaction_data_binding", passed: true },
      ],
      claims: { card: { credential_id: "dpc_abc", network: "VISA" } },
    },
    ...overrides,
  };
}

function stubBank(result: Awaited<ReturnType<BankClient["pay"]>>, spy?: (input: unknown) => void) {
  return {
    pay: vi.fn(async (input: unknown) => {
      spy?.(input);
      return result;
    }),
  } as unknown as BankClient;
}

async function seedSession(): Promise<string> {
  const started = await startPaymentSession(
    db,
    stubFoundry(createOk),
    "ord_1",
    "Demo Shop",
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
      stubFoundry({ id: "ver_1", state: "failed", created_at: 1, result: null }),
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
      stubFoundry(verdict({ result: { verified: false, checks: [], claims: {} } })),
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
            checks: [
              { check: "dcql_match", passed: true },
              { check: "transaction_data_binding", passed: false },
            ],
            claims: { card: { credential_id: "dpc_abc" } },
          },
        }),
      ),
      bank,
      sessionId,
    );

    expect(result).toMatchObject({
      ok: true,
      status: { state: "failed", failureReason: "transaction_data_binding_failed" },
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
            checks: [{ check: "transaction_data_binding", passed: true }],
            claims: { card: { network: "VISA" } },
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
});

describe("refreshPaymentSessionState — settlement phase", () => {
  it("debits the bank and completes the session and order", async () => {
    const sessionId = await seedSession();
    let sent: unknown = null;
    const bank = stubBank({ ok: true, bankTxId: "tx_bank_1" }, (input) => {
      sent = input;
    });

    const result = await refreshPaymentSessionState(db, stubFoundry(verdict()), bank, sessionId);

    expect(result).toMatchObject({ ok: true, status: { state: "completed" } });

    const session = db.select().from(paymentSessions).where(eq(paymentSessions.id, sessionId)).get();
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
    await refreshPaymentSessionState(db, stubFoundry(verdict()), bank, sessionId);

    const callsAfterFirst = (bank.pay as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    const second = await refreshPaymentSessionState(db, stubFoundry(verdict()), bank, sessionId);

    expect(second).toMatchObject({ ok: true, status: { state: "completed" } });
    expect((bank.pay as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      callsAfterFirst,
    );
  });

  it("resumes a session left in 'verified' by an interrupted earlier poll", async () => {
    const sessionId = await seedSession();
    // Simulate a process that passed the gate and stored the claims, then
    // stopped before calling the bank.
    db.update(paymentSessions)
      .set({
        state: "verified",
        disclosedClaimsJson: JSON.stringify({ card: { credential_id: "dpc_abc" } }),
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