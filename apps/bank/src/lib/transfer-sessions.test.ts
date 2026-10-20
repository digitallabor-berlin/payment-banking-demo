import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import {
  accounts,
  credentials,
  transactions,
  transferSessions,
} from "../db/schema.js";
import { seed } from "../db/seed.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "./credential-types.js";
import {
  TRANSFER_SESSION_TTL_MS,
  applyTransfer,
  getTransferStatus,
  refreshTransferState,
  relayTransferDcApiResponse,
  startTransfer,
} from "./transfer-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-transfer-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Capture {
  url: string;
  body: Record<string, unknown>;
}

interface Reply {
  status: number;
  body: unknown;
}

/**
 * Routes by path rather than replying with one canned body, exactly as the
 * limit-change suite's stub does. That is what lets a test fail the mint while
 * leaving the verification request perfectly able to succeed — the only way to
 * prove the second call is never reached.
 */
function stubClient(
  captures: Capture[],
  replies: { mint?: Reply; verify?: Reply },
): FoundryClient {
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    captures.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    const reply = url.includes("/admin/paso/ad-hoc-metadata")
      ? replies.mint
      : replies.verify;
    if (!reply) throw new Error(`no reply scripted for ${url}`);
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

const MINT_OK: Reply = {
  status: 200,
  body: { jwt: "minted.jwt.value", exp: 1792427805 },
};

const REQUEST_URI_OK: Reply = {
  status: 200,
  body: {
    verification_id: "v_transfer_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};

const DC_API_SIGNED_OK: Reply = {
  status: 200,
  body: {
    verification_id: "v_transfer_2",
    dc_api_request: { request: "eyJ0.eyJ1.sig" },
    protocol: "openid4vp-v1-signed",
  },
};

/** anna's seeded account: balance 348_712, daily limit 100_000. */
const ANNA = { userId: "user_anna", accountId: "acc_anna" };

/** A valid, normalised transfer. */
const VALID = {
  payeeName: "Max Mustermann",
  payeeIban: "DE89370400440532013000",
  amount: "250.00",
  purpose: "Rent October",
};

function rowOf(sessionId: string) {
  return db
    .select()
    .from(transferSessions)
    .where(eq(transferSessions.id, sessionId))
    .get();
}

function setLimit(accountId: string, cents: number) {
  db.update(accounts)
    .set({ dailyLimitCents: cents })
    .where(eq(accounts.id, accountId))
    .run();
}

function allRows() {
  return db.select().from(transferSessions).all();
}

describe("startTransfer", () => {
  it("refuses an account belonging to another customer with not_found", async () => {
    // Scoped by user as well as id, so another customer's account and a
    // nonexistent one are indistinguishable — the id is guessable and this
    // flow eventually debits the account it names.
    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, accountId: "acc_ben", ...VALID },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(allRows()).toHaveLength(0);
  });

  it("refuses invalid input with invalid_request and writes NO row", async () => {
    const captures: Capture[] = [];
    const result = await startTransfer(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID, amount: "abc" },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_request" });
    expect(allRows()).toHaveLength(0);
    expect(captures).toHaveLength(0);
  });

  it("refuses an amount above the daily limit with limit_exceeded", async () => {
    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID, amount: "1000.01" },
    );

    expect(result).toEqual({ ok: false, reason: "limit_exceeded" });
    expect(allRows()).toHaveLength(0);
  });

  it("ALLOWS an amount exactly equal to the daily limit", async () => {
    // The boundary decides whether a customer can send their whole limit. The
    // gate is `>`, so equal passes.
    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID, amount: "1000.00" },
    );

    expect(result.ok).toBe(true);
  });

  it("refuses an amount above the balance with insufficient_funds", async () => {
    // The seeded limit is below the seeded balance, so the balance gate is
    // unreachable until the limit is raised out of the way.
    setLimit(ANNA.accountId, 1_000_000);

    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID, amount: "3487.13" },
    );

    expect(result).toEqual({ ok: false, reason: "insufficient_funds" });
    expect(allRows()).toHaveLength(0);
  });

  it("ALLOWS an amount exactly equal to the balance", async () => {
    setLimit(ANNA.accountId, 1_000_000);

    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID, amount: "3487.12" },
    );

    expect(result.ok).toBe(true);
  });

  it("checks the limit and the balance BEFORE minting", async () => {
    // Nothing is scripted, so ANY admin call throws. Reaching the mint would
    // surface as `metadata_unavailable` rather than the money reason.
    const captures: Capture[] = [];
    const result = await startTransfer(db, stubClient(captures, {}), {
      ...ANNA,
      ...VALID,
      amount: "1000.01",
    });

    expect(result).toEqual({ ok: false, reason: "limit_exceeded" });
    expect(captures).toHaveLength(0);
  });

  it("mints metadata BEFORE creating the verification request", async () => {
    const captures: Capture[] = [];
    await startTransfer(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID },
    );

    expect(captures).toHaveLength(2);
    expect(captures[0]!.url).toContain("/admin/paso/ad-hoc-metadata");
    expect(captures[1]!.url).toContain("/admin/verification");
    // The minted JWT rides verbatim in the entry's `metadata`.
    const entries = captures[1]!.body.transaction_data as Array<
      Record<string, unknown>
    >;
    expect(entries[0]!.metadata).toBe("minted.jwt.value");
  });

  it("creates NO verification request when the mint fails", async () => {
    // Load-bearing, not belt-and-braces: foundry accepts an entry with no
    // `metadata` at HTTP 200 (measured), so the bank's own ordering is the
    // only thing standing between this demo and its anti-goal. The
    // verification reply is scripted as a perfectly good 200 — only the code
    // can stop the call.
    const captures: Capture[] = [];
    const result = await startTransfer(
      db,
      stubClient(captures, {
        mint: { status: 500, body: { error: "nope" } },
        verify: REQUEST_URI_OK,
      }),
      { ...ANNA, ...VALID },
    );

    expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
    expect(captures.every((c) => !c.url.includes("/admin/verification"))).toBe(
      true,
    );
  });

  it("fails the session with metadata_unavailable when the mint returns no jwt", async () => {
    // A 2xx is NOT a successful mint. `FoundryClient.request` throws only on a
    // non-2xx or a non-JSON body, so `{}` leaves `jwt` undefined with nothing
    // raised — and `JSON.stringify` would then silently DROP `metadata`.
    const captures: Capture[] = [];
    const result = await startTransfer(
      db,
      stubClient(captures, {
        mint: { status: 200, body: {} },
        verify: REQUEST_URI_OK,
      }),
      { ...ANNA, ...VALID },
    );

    expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
    expect(captures.every((c) => !c.url.includes("/admin/verification"))).toBe(
      true,
    );
    const row = allRows()[0]!;
    expect(row.state).toBe("failed");
    expect(row.failureReason).toBe("metadata_unavailable");
  });

  it("fails with metadata_unavailable when the mint throws", async () => {
    const result = await startTransfer(
      db,
      stubClient([], { verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID },
    );

    expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
    const row = allRows()[0]!;
    expect(row.state).toBe("failed");
    expect(row.failureReason).toBe("metadata_unavailable");
  });

  it("stores the normalised IBAN, not the typed one", async () => {
    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      {
        ...ANNA,
        ...VALID,
        payeeIban: "de89 3704 0044 0532 0130 00",
        payeeName: "  Max Mustermann ",
        purpose: " Rent October ",
      },
    );

    expect(result.ok).toBe(true);
    const row = allRows()[0]!;
    expect(row.payeeIban).toBe("DE89370400440532013000");
    expect(row.payeeName).toBe("Max Mustermann");
    expect(row.purpose).toBe("Rent October");
  });

  it("records the transport foundry SERVED, not the one requested", async () => {
    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: DC_API_SIGNED_OK }),
      { ...ANNA, ...VALID, transport: "dc_api_signed" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.transport).toBe("dc_api_signed");
    expect(result.session.dcApiProtocol).toBe("openid4vp-v1-signed");
    expect(result.session.uri).toBeNull();
    expect(rowOf(result.session.sessionId)?.transport).toBe("dc_api_signed");
  });

  it("records request_uri when dc_api_signed came back without an inline request", async () => {
    // A foundry too old to know `dc_api_signed` does not reject it — unknown
    // transport strings fall through to `direct_post.jwt`, so it answers with
    // a URI and no inline request object. Recording the REQUESTED value there
    // would leave the dialog offering a wallet button it cannot invoke while
    // suppressing the QR that would have worked.
    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID, transport: "dc_api_signed" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.transport).toBe("request_uri");
    expect(result.session.dcApiRequest).toBeNull();
    expect(result.session.dcApiProtocol).toBeNull();
    expect(result.session.uri).toBe(
      "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    );
    expect(rowOf(result.session.sessionId)?.transport).toBe("request_uri");
  });

  it("returns a DTO whose members match the row it wrote", async () => {
    const result = await startTransfer(
      db,
      stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...ANNA, ...VALID },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = rowOf(result.session.sessionId)!;
    expect(result.session).toEqual({
      sessionId: row.id,
      accountId: row.accountId,
      uri: row.openid4vpUri,
      transport: row.transport,
      dcApiRequest: null,
      dcApiProtocol: row.dcApiProtocol,
      state: row.state,
      payeeName: row.payeeName,
      payeeIban: row.payeeIban,
      amountCents: row.amountCents,
      purpose: row.purpose,
    });
    expect(row.id).toMatch(/^transfer_/);
    expect(row.startedByUserId).toBe("user_anna");
    expect(row.approvedByUserId).toBeNull();
    expect(row.transactionId).toBeNull();
    expect(row.foundryVerificationId).toBe("v_transfer_1");
  });

  it("fails with foundry_unavailable when the verification request throws", async () => {
    const result = await startTransfer(
      db,
      stubClient([], {
        mint: MINT_OK,
        verify: { status: 503, body: { error: "down" } },
      }),
      { ...ANNA, ...VALID },
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = allRows()[0]!;
    expect(row.state).toBe("failed");
    expect(row.failureReason).toBe("foundry_unavailable");
    // The row names the transport that FAILED.
    expect(row.transport).toBe("request_uri");
  });
});
/**
 * A verdict shaped like the one foundry serves for the `sparkassen_auth` named
 * query. `bound: false` models a wallet that ignored the `transaction_data`
 * entry — the case the binding gate exists for.
 */
function authVerdict(sub: unknown, verified = true, bound = true) {
  return {
    id: "v_transfer_1",
    state: verified ? "verified" : "failed",
    created_at: 0,
    result: {
      verified,
      checks: [],
      credentials: [
        {
          query_id: "sparkassen_auth",
          format: "dc+sd-jwt",
          claims: { sub },
          checks: bound
            ? [{ check: "transaction_data_binding", passed: true }]
            : [],
        },
      ],
    },
  };
}

/** Counts polls as well as answering them, so "no traffic" is provable. */
function verdictClient(
  verdict: unknown,
  calls: string[] = [],
  status = 200,
): FoundryClient {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/admin/verification/requests/")) {
      return new Response(JSON.stringify(verdict), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    const body = url.includes("/admin/paso/ad-hoc-metadata")
      ? MINT_OK.body
      : REQUEST_URI_OK.body;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;

  return new FoundryClient({
    adminUrl: "http://f:9000",
    adminKey: "k",
    fetchImpl,
  });
}

/**
 * Opens a real pending session for `user_anna` / `acc_anna`.
 *
 * `now` defaults to the real clock because `refreshTransferState`'s own `now`
 * does: a fixed epoch here would put every session past
 * `TRANSFER_SESSION_TTL_MS` before the first poll, and every case below would
 * read `expired` instead of what it is about. The expiry case passes a matched
 * pair explicitly.
 */
async function openSession(now = Date.now()): Promise<string> {
  const result = await startTransfer(
    db,
    stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
    { ...ANNA, ...VALID },
    now,
  );
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.session.sessionId;
}

/** Issues an authenticator credential row carrying `sub`, owned by `userId`. */
function giveAuthenticator(userId: string, sub: string): void {
  db.insert(credentials)
    .values({
      id: `cred_${sub}`,
      userId,
      cardId: null,
      credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
      credentialId: sub,
      state: "active",
      createdAt: 1,
    })
    .run();
}

const POLL = { userId: "user_anna", accountId: "acc_anna" };

function reasonOf(sessionId: string): string | null {
  return rowOf(sessionId)?.failureReason ?? null;
}

describe("refreshTransferState", () => {
  it("answers not_found for another customer's session", async () => {
    const sessionId = await openSession();
    const calls: string[] = [];

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...POLL, userId: "user_ben", sessionId },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it("makes no foundry call for an applied or failed session", async () => {
    for (const state of ["applied", "failed"] as const) {
      const sessionId = await openSession();
      db.update(transferSessions)
        .set({ state })
        .where(eq(transferSessions.id, sessionId))
        .run();
      const calls: string[] = [];

      const result = await refreshTransferState(
        db,
        verdictClient(authVerdict("s"), calls),
        { ...POLL, sessionId },
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.status.state).toBe(state);
      expect(calls).toHaveLength(0);
    }
  });

  it("makes no foundry call once verified", async () => {
    // Approved and waiting for the apply. Re-polling foundry would tell us
    // nothing that is not already recorded.
    const sessionId = await openSession();
    db.update(transferSessions)
      .set({ state: "verified" })
      .where(eq(transferSessions.id, sessionId))
      .run();
    const calls: string[] = [];

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("verified");
    expect(calls).toHaveLength(0);
  });

  it("fails with expired past the TTL, without calling foundry", async () => {
    const started = 1_000_000;
    const sessionId = await openSession(started);
    const calls: string[] = [];

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...POLL, sessionId },
      started + TRANSFER_SESSION_TTL_MS + 1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("failed");
    expect(result.status.failureReason).toBe("expired");
    // An abandoned tab stops costing admin-API traffic the moment it expires.
    expect(calls).toHaveLength(0);
  });

  it("stays pending while foundry says pending", async () => {
    const sessionId = await openSession();

    const result = await refreshTransferState(
      db,
      verdictClient({ id: "v_transfer_1", state: "pending", created_at: 0 }),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("pending");
  });

  it("stays pending when the status call throws", async () => {
    // Transient. A 503 on one poll of a five-minute window must not kill the
    // session — only the client's consecutive-failure counter gives up.
    // `refreshLimitChangeState` behaves identically; see the ledger ruling.
    const sessionId = await openSession();

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("s"), [], 503),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("pending");
    expect(reasonOf(sessionId)).toBeNull();
  });

  it("fails with verification_failed when foundry says not verified", async () => {
    const sessionId = await openSession();

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("s", false)),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("failed");
    expect(result.status.failureReason).toBe("verification_failed");
  });

  it("fails with verification_failed when no authenticator answered", async () => {
    // Either nothing answered the authenticator query, or what did disclosed
    // no usable `sub`. Both are the wallet's answer being wrong, not the
    // customer being unknown.
    const sessionId = await openSession();

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict(undefined)),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.failureReason).toBe("verification_failed");
  });

  it("fails with transaction_data_binding_failed when the binding did not pass", async () => {
    // A wallet that ignored the entry yields a verdict that is
    // `verified: true` and still worthless: nothing in it is tied to THESE
    // four values, so it attests an approval of a transfer the holder may
    // never have seen.
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("sub_anna", true, false)),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.failureReason).toBe("transaction_data_binding_failed");
  });

  it("gates the binding BEFORE resolving the sub", async () => {
    // A `sub` NO credential carries, with the binding ALSO failing. The two
    // orderings give different answers, so this pins the order:
    //   binding first  → transaction_data_binding_failed
    //   resolve first  → unknown_credential
    // Using the signed-in customer's own `sub` would fail the binding under
    // either ordering and therefore pin nothing.
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("sub_nobody_holds", true, false)),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.failureReason).toBe("transaction_data_binding_failed");
  });

  it("fails with unknown_credential for a sub this bank cannot place", async () => {
    // A real, correctly-signed credential this bank cannot match to a
    // customer. Expected for anything issued before the `sub` was persisted;
    // there is no backfill, and the copy for this reason names the remedy.
    const sessionId = await openSession();

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("sub_nobody_holds")),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.failureReason).toBe("unknown_credential");
  });

  it("fails with wrong_customer for another customer's authenticator", async () => {
    // THE GATE THIS FLOW ADDS. Without it any valid Sparkassen Authenticator
    // presentation could approve any signed-in customer's transfer.
    const sessionId = await openSession();
    giveAuthenticator("user_ben", "sub_ben");

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("sub_ben")),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("failed");
    // Its OWN reason, distinct from `unknown_credential`, so an operator can
    // tell a credential issued to the wrong person from one the bank cannot
    // place at all. The holder sees the same generic copy for both.
    expect(result.status.failureReason).toBe("wrong_customer");
    expect(rowOf(sessionId)?.approvedByUserId).toBeNull();
  });

  it("verifies and records approvedByUserId when the owner approved", async () => {
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("sub_anna")),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("verified");
    expect(result.status.failureReason).toBeUndefined();
    // The status carries these because the dialog's success copy names them
    // and by then it holds only a session id.
    expect(result.status.amountCents).toBe(25_000);
    expect(result.status.payeeName).toBe("Max Mustermann");

    const row = rowOf(sessionId)!;
    expect(row.state).toBe("verified");
    expect(row.approvedByUserId).toBe("user_anna");
    // Only ever written EQUAL to `started_by_user_id` — that equality is the
    // whole of what the gate enforces.
    expect(row.approvedByUserId).toBe(row.startedByUserId);
  });

  it("verifies a credential that is not active, because foundry already said it is real", async () => {
    // Deliberately NOT gated on `credential.state`: foundry's verdict is the
    // authority that the credential is real and holder-bound; this row only
    // answers WHOSE. Nothing in this project ever clears an `offered` row.
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");
    db.update(credentials)
      .set({ state: "offered" })
      .where(eq(credentials.credentialId, "sub_anna"))
      .run();

    const result = await refreshTransferState(
      db,
      verdictClient(authVerdict("sub_anna")),
      { ...POLL, sessionId },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status.state).toBe("verified");
  });
});

describe("getTransferStatus", () => {
  it("answers null for another customer's session", async () => {
    const sessionId = await openSession();
    expect(
      getTransferStatus(db, "user_ben", "acc_anna", sessionId),
    ).toBeNull();
  });

  it("answers null for a session on another account", async () => {
    const sessionId = await openSession();
    expect(
      getTransferStatus(db, "user_anna", "acc_ben", sessionId),
    ).toBeNull();
  });

  it("makes no foundry call", async () => {
    const sessionId = await openSession();
    const status = getTransferStatus(db, "user_anna", "acc_anna", sessionId);
    expect(status).toEqual({
      state: "pending",
      failureReason: undefined,
      amountCents: 25_000,
      payeeName: "Max Mustermann",
    });
  });
});

/** Drives a real session all the way to `verified` through the poll's gates. */
async function verifiedSession(
  sub = "sub_anna",
  now = Date.now(),
): Promise<string> {
  const sessionId = await openSession(now);
  giveAuthenticator("user_anna", sub);
  const polled = await refreshTransferState(
    db,
    verdictClient(authVerdict(sub)),
    { ...POLL, sessionId },
    now,
  );
  if (!polled.ok || polled.status.state !== "verified") {
    throw new Error("expected a verified session");
  }
  return sessionId;
}

function accountOf(id = "acc_anna") {
  return db.select().from(accounts).where(eq(accounts.id, id)).get()!;
}

function setMoney(limitCents: number, balanceCents: number, id = "acc_anna") {
  db.update(accounts)
    .set({ dailyLimitCents: limitCents, balanceCents })
    .where(eq(accounts.id, id))
    .run();
}

function transferRows() {
  return db
    .select()
    .from(transactions)
    .where(eq(transactions.counterparty, "Max Mustermann"))
    .all();
}

describe("applyTransfer", () => {
  it("refuses another customer's session with not_found", async () => {
    const sessionId = await verifiedSession();
    expect(
      applyTransfer(db, { ...POLL, userId: "user_ben", sessionId }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a pending session with not_verified", async () => {
    const sessionId = await openSession();
    expect(applyTransfer(db, { ...POLL, sessionId })).toEqual({
      ok: false,
      reason: "not_verified",
    });
  });

  it("refuses an applied session with already_applied", async () => {
    // Distinguished from `not_verified` so the route can answer 410 rather
    // than 409: an applied session is gone for good.
    const sessionId = await verifiedSession();
    expect(applyTransfer(db, { ...POLL, sessionId }).ok).toBe(true);

    expect(applyTransfer(db, { ...POLL, sessionId })).toEqual({
      ok: false,
      reason: "already_applied",
    });
  });

  it("refuses past the TTL with expired", async () => {
    const started = 1_000_000;
    const sessionId = await verifiedSession("sub_anna", started);

    expect(
      applyTransfer(
        db,
        { ...POLL, sessionId },
        started + TRANSFER_SESSION_TTL_MS + 1,
      ),
    ).toEqual({ ok: false, reason: "expired" });
    expect(transferRows()).toHaveLength(0);
  });

  it("refuses with limit_exceeded when the limit dropped under it", async () => {
    // A limit change running in another tab can lower the limit underneath a
    // transfer that is already in the wallet. The limit is NOT signed — it is
    // a precondition, re-checked against the live account.
    const sessionId = await verifiedSession();
    setMoney(24_999, accountOf().balanceCents);

    expect(applyTransfer(db, { ...POLL, sessionId })).toEqual({
      ok: false,
      reason: "limit_exceeded",
    });
    expect(transferRows()).toHaveLength(0);
  });

  it("leaves the session VERIFIED after a limit_exceeded refusal", async () => {
    // Refusing BEFORE the guarded write leaves the session claimable, so a
    // transient refusal does not burn the holder's approval: undo whatever
    // moved the limit and this same session still applies.
    const sessionId = await verifiedSession();
    setMoney(24_999, accountOf().balanceCents);
    applyTransfer(db, { ...POLL, sessionId });

    expect(rowOf(sessionId)?.state).toBe("verified");

    setMoney(100_000, accountOf().balanceCents);
    expect(applyTransfer(db, { ...POLL, sessionId }).ok).toBe(true);
  });

  it("refuses with insufficient_funds when the balance dropped under it", async () => {
    const sessionId = await verifiedSession();
    setMoney(100_000, 24_999);

    expect(applyTransfer(db, { ...POLL, sessionId })).toEqual({
      ok: false,
      reason: "insufficient_funds",
    });
    expect(transferRows()).toHaveLength(0);
  });

  it("leaves the session VERIFIED after an insufficient_funds refusal", async () => {
    const sessionId = await verifiedSession();
    setMoney(100_000, 24_999);
    applyTransfer(db, { ...POLL, sessionId });

    expect(rowOf(sessionId)?.state).toBe("verified");
  });

  it("ALLOWS an amount exactly equal to the current limit and balance", async () => {
    // Both gates are `>`, so equality passes and a customer can send their
    // whole balance.
    const sessionId = await verifiedSession();
    setMoney(25_000, 25_000);

    const result = applyTransfer(db, { ...POLL, sessionId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newBalanceCents).toBe(0);
  });

  it("debits the account by the amount", async () => {
    const sessionId = await verifiedSession();
    const before = accountOf().balanceCents;

    const result = applyTransfer(db, { ...POLL, sessionId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.newBalanceCents).toBe(before - 25_000);
    expect(accountOf().balanceCents).toBe(before - 25_000);
  });

  it("books a NEGATIVE transaction carrying the name and the purpose", async () => {
    const sessionId = await verifiedSession();
    applyTransfer(db, { ...POLL, sessionId });

    const rows = transferRows();
    expect(rows).toHaveLength(1);
    const tx = rows[0]!;
    // Negative: it is a debit, and that is the ledger's convention.
    expect(tx.amountCents).toBe(-25_000);
    expect(tx.counterparty).toBe("Max Mustermann");
    expect(tx.reference).toBe("Rent October");
    expect(tx.idempotencyKey).toBe(sessionId);
    expect(tx.accountId).toBe("acc_anna");
  });

  it("records the approving authenticator as the transaction's credential_id", async () => {
    // The way a card payment records the credential that authorised it.
    const sessionId = await verifiedSession("sub_anna");
    applyTransfer(db, { ...POLL, sessionId });

    expect(transferRows()[0]!.credentialId).toBe("sub_anna");
  });

  it("writes transaction_id onto the session in the same transaction", async () => {
    const sessionId = await verifiedSession();
    const result = applyTransfer(db, { ...POLL, sessionId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = rowOf(sessionId)!;
    expect(row.state).toBe("applied");
    // A session and its debit can never disagree about whether it happened.
    expect(row.transactionId).toBe(result.transactionId);
    expect(transferRows()[0]!.id).toBe(result.transactionId);
  });

  it("debits exactly ONCE across two applies", async () => {
    const sessionId = await verifiedSession();
    const before = accountOf().balanceCents;

    expect(applyTransfer(db, { ...POLL, sessionId }).ok).toBe(true);

    // RESTORE the balance before the replay. Leaving the account short means
    // the money gate refuses the second call, and this test would then pass
    // with the guarded UPDATE deleted.
    setMoney(100_000, before);

    expect(applyTransfer(db, { ...POLL, sessionId })).toEqual({
      ok: false,
      reason: "already_applied",
    });
    expect(transferRows()).toHaveLength(1);
    expect(accountOf().balanceCents).toBe(before);
  });

  it("writes NOTHING when the transaction insert throws", async () => {
    // Belt and braces: `idempotency_key` carries a unique index, so the
    // database enforces single-debit independently of the state machine. A
    // collision must roll the whole thing back rather than leave the session
    // `applied` with no debit behind it.
    const sessionId = await verifiedSession();
    const before = accountOf().balanceCents;
    db.insert(transactions)
      .values({
        id: "tx_squatter",
        accountId: "acc_anna",
        amountCents: -1,
        counterparty: "Squatter",
        reference: "holds the key",
        bookedAt: 1,
        idempotencyKey: sessionId,
      })
      .run();

    // Asserted on the MESSAGE, not merely that something threw: this test
    // passed vacuously while `applyTransfer` was undefined, because calling
    // undefined throws too.
    expect(() => applyTransfer(db, { ...POLL, sessionId })).toThrow(
      /UNIQUE constraint/i,
    );

    expect(accountOf().balanceCents).toBe(before);
    expect(rowOf(sessionId)?.state).toBe("verified");
    expect(rowOf(sessionId)?.transactionId).toBeNull();
    expect(transferRows()).toHaveLength(0);
  });
});

describe("relayTransferDcApiResponse", () => {
  it("refuses another customer's session with not_found", async () => {
    const sessionId = await openSession();
    const calls: string[] = [];

    const result = await relayTransferDcApiResponse(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...POLL, userId: "user_ben", sessionId, response: "vp" },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it("answers no_verification before foundry exists", async () => {
    const sessionId = await openSession();
    db.update(transferSessions)
      .set({ foundryVerificationId: null })
      .where(eq(transferSessions.id, sessionId))
      .run();

    const result = await relayTransferDcApiResponse(
      db,
      verdictClient(authVerdict("s")),
      { ...POLL, sessionId, response: "vp" },
    );

    expect(result).toEqual({ ok: false, reason: "no_verification" });
  });

  it("forwards the response to foundry and discards the verdict", async () => {
    // foundry's verdict is deliberately discarded: the transaction state it
    // also writes is what the poll already running in the dialog reads. One
    // state path, not two.
    const sessionId = await openSession();
    const calls: string[] = [];

    const result = await relayTransferDcApiResponse(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...POLL, sessionId, response: "vp-token-here" },
    );

    expect(result).toEqual({ ok: true });
    expect(calls.some((url) => url.includes("dc-api-response"))).toBe(true);
    // The relay never moves the session itself.
    expect(rowOf(sessionId)?.state).toBe("pending");
  });

  it("answers foundry_unavailable when the submit throws", async () => {
    const sessionId = await openSession();

    const result = await relayTransferDcApiResponse(
      db,
      verdictClient(authVerdict("s"), [], 503),
      { ...POLL, sessionId, response: "vp" },
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
  });
});
