import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { accounts, limitChangeSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { startLimitChange } from "./limit-change-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-limit-"));
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
 * This flow makes TWO admin calls — the mint and the verification request — so
 * the stub routes by path rather than replying with one canned body. That is
 * what lets a test fail the mint while leaving the verification request
 * perfectly able to succeed, which is the only way to prove it is never
 * reached.
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
    verification_id: "v_limit_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};

const DC_API_SIGNED_OK: Reply = {
  status: 200,
  body: {
    verification_id: "v_limit_2",
    dc_api_request: { request: "eyJ0.eyJ1.sig" },
    protocol: "openid4vp-v1-signed",
  },
};

function rowOf(sessionId: string) {
  return db
    .select()
    .from(limitChangeSessions)
    .where(eq(limitChangeSessions.id, sessionId))
    .get();
}

function onlyRow() {
  return db.select().from(limitChangeSessions).get();
}

/**
 * The happy-path input: anna raising her own account from 1.000 € to 2.000 €.
 *
 * No `transport`, so these cases exercise the default — `request_uri`, which
 * works in every browser. The cases that name one spread it in.
 */
const input = {
  userId: "user_anna",
  accountId: "acc_anna",
  newLimitCents: 200_000,
};

/** The call under test, with a verification-request body captured. */
function mintCalls(captures: Capture[]) {
  return captures.filter((c) => c.url.includes("/admin/paso/ad-hoc-metadata"));
}

function verifyCalls(captures: Capture[]) {
  return captures.filter((c) =>
    c.url.includes("/admin/verification/requests"),
  );
}

describe("startLimitChange ownership and validation", () => {
  it("refuses an account the user does not own", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, accountId: "acc_ben" },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    // Indistinguishable from nonexistent, and no traffic: the caller must not
    // be able to probe for which accounts exist.
    expect(captures).toHaveLength(0);
    expect(onlyRow()).toBeUndefined();
  });

  it("refuses a nonexistent account with the same reason", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, accountId: "acc_nobody" },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(captures).toHaveLength(0);
  });

  it("refuses a new limit that is not a selectable preset", async () => {
    // Delegates to isValidNewLimit — the whole matrix is limit-presets.test.ts.
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, newLimitCents: 150_000 },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_limit" });
    expect(captures).toHaveLength(0);
    expect(onlyRow()).toBeUndefined();
  });

  it("refuses the limit already in force", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, newLimitCents: 100_000 },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_limit" });
  });
});

describe("startLimitChange", () => {
  it("writes a pending row before calling foundry", async () => {
    // The mint throws, so nothing after the first write can have run — and a
    // `failed` row still exists naming the attempted transport.
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: { status: 503, body: {} } }),
      { ...input, transport: "dc_api_signed" },
    );

    expect(result.ok).toBe(false);
    const row = onlyRow();
    expect(row?.state).toBe("failed");
    expect(row?.transport).toBe("dc_api_signed");
    expect(row?.startedByUserId).toBe("user_anna");
    expect(row?.accountId).toBe("acc_anna");
  });

  it("snapshots the account's current limit", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(result.ok).toBe(true);
    const row = onlyRow();
    expect(row?.oldLimitCents).toBe(100_000);
    expect(row?.newLimitCents).toBe(200_000);
  });

  it("mints the metadata and passes the jwt into transaction_data", async () => {
    const captures: Capture[] = [];
    await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(mintCalls(captures)).toHaveLength(1);
    const entry = (
      verifyCalls(captures)[0]!.body.transaction_data as Array<
        Record<string, unknown>
      >
    )[0]!;
    expect(entry.metadata).toBe("minted.jwt.value");
    expect(entry.payload).toEqual({
      old_limit: "EUR 1000.00",
      new_limit: "EUR 2000.00",
    });
  });

  it("asks for the authenticator named query", async () => {
    const captures: Capture[] = [];
    await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(verifyCalls(captures)[0]!.body.named_query_ref).toBe(
      "sparkassen_auth",
    );
    // No inline dcql_query: foundry prefers one and would silently ignore the
    // named query if both were sent.
    expect(verifyCalls(captures)[0]!.body.dcql_query).toBeUndefined();
  });

  /**
   * Review Focus 1 — the anti-goal made executable.
   *
   * A `transaction_data` entry with no `metadata`, for a type no credential's
   * metadata declares, is PaSO Core §7.4.2 "incompatible": best case a refusal,
   * worst case raw claim names on a human's screen. Neither is worth having
   * instead of an error message. The verification reply is scripted OK here, so
   * the only thing stopping it being created is the code.
   */
  it("creates NO verification request when the mint fails", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, {
        mint: { status: 400, body: { error: "unknown credential_type_id" } },
        verify: REQUEST_URI_OK,
      }),
      input,
    );

    expect(verifyCalls(captures)).toHaveLength(0);
    expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
    const row = onlyRow();
    expect(row?.state).toBe("failed");
    // Its OWN reason: "foundry is down" and "foundry will not describe this
    // type" are different operator problems.
    expect(row?.failureReason).toBe("metadata_unavailable");
    expect(row?.foundryVerificationId).toBeNull();
  });

  it("leaves the account's limit untouched when the mint fails", async () => {
    const captures: Capture[] = [];
    await startLimitChange(
      db,
      stubClient(captures, { mint: { status: 400, body: {} } }),
      input,
    );

    const account = db
      .select()
      .from(accounts)
      .where(eq(accounts.id, "acc_anna"))
      .get();
    expect(account?.dailyLimitCents).toBe(100_000);
  });

  it("records the transport foundry actually served", async () => {
    // Asked dc_api_signed; a foundry too old to know it answers with a URI and
    // no inline request object rather than rejecting. Recording the REQUESTED
    // value would leave the dialog offering a wallet button it cannot invoke
    // while suppressing the QR that would have worked.
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, transport: "dc_api_signed" },
    );

    expect(result.ok).toBe(true);
    const row = onlyRow();
    expect(row?.transport).toBe("request_uri");
    expect(row?.dcApiProtocol).toBeNull();
    expect(row?.dcApiRequestJson).toBeNull();
    if (result.ok) {
      expect(result.session.transport).toBe("request_uri");
      expect(result.session.uri).toBe(
        "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
      );
    }
  });

  it("records dc_api_signed when foundry serves it", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: DC_API_SIGNED_OK }),
      { ...input, transport: "dc_api_signed" },
    );

    const row = onlyRow();
    expect(row?.transport).toBe("dc_api_signed");
    // Persisted VERBATIM from foundry, never derived: a signed request object
    // sent under the unsigned identifier fails inside the wallet with no
    // server-side trace.
    expect(row?.dcApiProtocol).toBe("openid4vp-v1-signed");
    expect(row?.dcApiRequestJson).toBe('{"request":"eyJ0.eyJ1.sig"}');
    expect(result).toEqual({
      ok: true,
      session: {
        sessionId: row!.id,
        accountId: "acc_anna",
        uri: null,
        transport: "dc_api_signed",
        dcApiRequest: { request: "eyJ0.eyJ1.sig" },
        dcApiProtocol: "openid4vp-v1-signed",
        state: "pending",
        oldLimitCents: 100_000,
        newLimitCents: 200_000,
      },
    });
  });

  it("fails the row when foundry refuses the verification request", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, {
        mint: MINT_OK,
        verify: { status: 400, body: { error: "unknown named_query_ref" } },
      }),
      input,
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    const row = onlyRow();
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("foundry_unavailable");
  });

  it("mints a limit_-prefixed session id", async () => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.session.sessionId).toMatch(/^limit_[0-9a-f-]{36}$/);
    expect(rowOf(result.session.sessionId)).toBeDefined();
  });
});