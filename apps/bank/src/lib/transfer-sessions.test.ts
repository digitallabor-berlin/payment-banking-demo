import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { accounts, transferSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { startTransfer } from "./transfer-sessions.js";

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