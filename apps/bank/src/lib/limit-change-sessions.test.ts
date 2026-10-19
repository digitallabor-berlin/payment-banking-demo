import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { accounts, credentials, limitChangeSessions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "./credential-types.js";
import {
  LIMIT_CHANGE_SESSION_TTL_MS,
  applyLimitChange,
  getLimitChangeStatus,
  refreshLimitChangeState,
  relayLimitChangeDcApiResponse,
  startLimitChange,
} from "./limit-change-sessions.js";

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

  /**
   * Found by the final review. `FoundryClient.request` does
   * `JSON.parse(text) as T` and throws only on a non-2xx or non-JSON body, so a
   * 200 carrying `{}` — a proxy, a renamed field, a future build — leaves
   * `minted.jwt` undefined. `JSON.stringify` then DROPS `metadata` silently and
   * the anti-goal entry goes out over the wire. The `metadataJwt: string`
   * contract is a compile-time claim that an `as` cast makes for it, which is
   * the exact lesson AGENTS.md already records about `as` over `.json()`.
   *
   * Measured 2026-10-19: foundry ACCEPTS an entry with `metadata` omitted, HTTP
   * 200. So this ordering is the only enforcement that exists anywhere.
   */
  it.each([
    ["an empty body", {}],
    ["a null jwt", { jwt: null, exp: 1 }],
    ["a renamed field", { token: "a.b.c", exp: 1 }],
    ["an empty jwt", { jwt: "", exp: 1 }],
  ])("creates NO verification request when the mint returns 200 with %s", async (
    _label,
    body,
  ) => {
    const captures: Capture[] = [];
    const result = await startLimitChange(
      db,
      stubClient(captures, { mint: { status: 200, body }, verify: REQUEST_URI_OK }),
      input,
    );

    expect(verifyCalls(captures)).toHaveLength(0);
    expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
    expect(onlyRow()?.state).toBe("failed");
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
/**
 * A verdict shaped like the one foundry serves for the `sparkassen_auth` named
 * query. `bound: false` models a wallet that ignored the `transaction_data`
 * entry — the case the binding gate exists for.
 */
function authVerdict(sub: unknown, verified = true, bound = true) {
  return {
    id: "v_limit_1",
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
 * `now` defaults to the real clock because `refreshLimitChangeState`'s own
 * `now` does: a fixed epoch here would put every session past
 * `LIMIT_CHANGE_SESSION_TTL_MS` before the first poll, and every case below
 * would read `expired` instead of what it is about. The expiry case passes a
 * matched pair explicitly.
 */
async function openSession(now = Date.now()): Promise<string> {
  const result = await startLimitChange(
    db,
    stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
    input,
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

const poll = { userId: "user_anna", accountId: "acc_anna" };

function accountLimit(id = "acc_anna"): number | undefined {
  return db.select().from(accounts).where(eq(accounts.id, id)).get()
    ?.dailyLimitCents;
}

describe("refreshLimitChangeState scoping", () => {
  /** Review Focus 4 — the id is guessable and the flow writes to an account. */
  it("answers not_found for another user's session", async () => {
    const sessionId = await openSession();
    const calls: string[] = [];
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s"), calls),
      { userId: "user_ben", accountId: "acc_anna", sessionId },
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(calls).toHaveLength(0);
  });

  it("answers not_found for the right session under the wrong account", async () => {
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s")),
      { ...poll, accountId: "acc_ben", sessionId },
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("answers not_found for a nonexistent session", async () => {
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s")),
      { ...poll, sessionId: "limit_nope" },
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("getLimitChangeStatus is scoped the same three ways", async () => {
    const sessionId = await openSession();
    expect(getLimitChangeStatus(db, "user_anna", "acc_anna", sessionId)).toEqual(
      { state: "pending", newLimitCents: 200_000 },
    );
    expect(
      getLimitChangeStatus(db, "user_ben", "acc_anna", sessionId),
    ).toBeNull();
    expect(
      getLimitChangeStatus(db, "user_anna", "acc_ben", sessionId),
    ).toBeNull();
    expect(
      getLimitChangeStatus(db, "user_anna", "acc_anna", "limit_nope"),
    ).toBeNull();
  });
});

describe("refreshLimitChangeState", () => {
  it("stops polling on a terminal state", async () => {
    const sessionId = await openSession();
    db.update(limitChangeSessions)
      .set({ state: "failed", failureReason: "expired" })
      .where(eq(limitChangeSessions.id, sessionId))
      .run();

    const calls: string[] = [];
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...poll, sessionId },
    );
    expect(result).toMatchObject({ ok: true, status: { state: "failed" } });
    expect(calls).toHaveLength(0);
  });

  it("stops polling once applied", async () => {
    const sessionId = await openSession();
    db.update(limitChangeSessions)
      .set({ state: "applied" })
      .where(eq(limitChangeSessions.id, sessionId))
      .run();

    const calls: string[] = [];
    await refreshLimitChangeState(db, verdictClient(authVerdict("s"), calls), {
      ...poll,
      sessionId,
    });
    expect(calls).toHaveLength(0);
  });

  it("fails an expired session without calling foundry", async () => {
    const sessionId = await openSession(1000);
    const calls: string[] = [];
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...poll, sessionId },
      1000 + LIMIT_CHANGE_SESSION_TTL_MS + 1,
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.state).toBe("failed");
    expect(result.status.failureReason).toBe("expired");
    // An abandoned tab must stop costing admin-API traffic the moment its
    // window closes.
    expect(calls).toHaveLength(0);
  });

  it("stays pending when foundry has no verdict yet", async () => {
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient({ id: "v_limit_1", state: "pending", created_at: 0 }),
      { ...poll, sessionId },
    );
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("stays pending when foundry is unreachable", async () => {
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s"), [], 503),
      { ...poll, sessionId },
    );
    // Transient. Only the client's consecutive-failure counter gives up.
    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("fails on an unverified verdict", async () => {
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s", false)),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("verification_failed");
  });

  it("fails when no authenticator credential answered", async () => {
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient({
        id: "v_limit_1",
        state: "verified",
        created_at: 0,
        result: { verified: true, checks: [], credentials: [] },
      }),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("verification_failed");
  });

  it("fails when the wallet did not sign over transaction_data", async () => {
    giveAuthenticator("user_anna", "sub-anna");
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-anna", true, false)),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    // Its own reason, so an operator can tell "the wallet does not honour
    // transaction_data" from every other bad presentation. The holder sees the
    // generic copy either way.
    expect(result.status.failureReason).toBe("transaction_data_binding_failed");
  });

  it("gates the binding before resolving the sub, not after", async () => {
    // An unbound presentation must never reach the point where a `sub` becomes
    // a customer: reading a claim out of a JSON blob is inert, turning it into
    // an identity is the act.
    //
    // The `sub` here is deliberately one NO credential carries, so the two
    // orderings give different answers: gate-then-resolve says
    // transaction_data_binding_failed, resolve-then-gate says
    // unknown_credential. The first version of this test used anna's own `sub`,
    // which fails the binding check under BOTH orderings — it was green on
    // arrival and pinned nothing. Found by the final review.
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-nobody-holds", true, false)),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("transaction_data_binding_failed");
  });

  it("gates the binding before the OWNER check too", async () => {
    // Same property one step further along: a stranger's unbound presentation
    // must report the binding failure, not wrong_customer.
    giveAuthenticator("user_ben", "sub-ben");
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-ben", true, false)),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("transaction_data_binding_failed");
  });

  it("fails when the sub matches no credential", async () => {
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-unknown")),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("unknown_credential");
  });

  /**
   * The gate this flow adds over wallet login.
   *
   * Login resolves a `sub` to WHOEVER owns that authenticator — nobody is
   * signed in yet, so that is the point. Here somebody is, and without this
   * check any valid Sparkassen Authenticator presentation could approve any
   * logged-in customer's limit change.
   */
  it("fails when the approving authenticator belongs to someone else", async () => {
    giveAuthenticator("user_ben", "sub-ben");
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-ben")),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("wrong_customer");
    const row = rowOf(sessionId);
    expect(row?.state).toBe("failed");
    expect(row?.approvedByUserId).toBeNull();
  });

  it("distinguishes a stranger's credential from an unregistered one", async () => {
    // Two different operator problems: one is a credential this bank issued to
    // the wrong person for this session, the other is a credential it cannot
    // match at all (commonest cause: issued before the sub was persisted).
    giveAuthenticator("user_ben", "sub-ben");
    const strangerSession = await openSession();
    await refreshLimitChangeState(db, verdictClient(authVerdict("sub-ben")), {
      ...poll,
      sessionId: strangerSession,
    });
    const unknownSession = await openSession();
    await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-nobody")),
      { ...poll, sessionId: unknownSession },
    );

    expect(rowOf(strangerSession)?.failureReason).toBe("wrong_customer");
    expect(rowOf(unknownSession)?.failureReason).toBe("unknown_credential");
  });

  it("verifies and records who approved", async () => {
    giveAuthenticator("user_anna", "sub-anna");
    const sessionId = await openSession();
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-anna")),
      { ...poll, sessionId },
    );

    expect(result).toEqual({
      ok: true,
      status: { state: "verified", newLimitCents: 200_000 },
    });
    const row = rowOf(sessionId);
    expect(row?.state).toBe("verified");
    expect(row?.approvedByUserId).toBe("user_anna");
  });

  it("writes no limit of its own", async () => {
    giveAuthenticator("user_anna", "sub-anna");
    const sessionId = await openSession();
    await refreshLimitChangeState(db, verdictClient(authVerdict("sub-anna")), {
      ...poll,
      sessionId,
    });
    // The poll drives state only. Writing the limit is apply's job, on a POST.
    expect(accountLimit()).toBe(100_000);
  });

  it("does not re-poll a verified session", async () => {
    giveAuthenticator("user_anna", "sub-anna");
    const sessionId = await openSession();
    await refreshLimitChangeState(db, verdictClient(authVerdict("sub-anna")), {
      ...poll,
      sessionId,
    });

    const calls: string[] = [];
    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("sub-anna"), calls),
      { ...poll, sessionId },
    );
    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
    expect(calls).toHaveLength(0);
  });

  it("fails a session foundry never gave a verification id", async () => {
    const sessionId = await openSession();
    db.update(limitChangeSessions)
      .set({ foundryVerificationId: null })
      .where(eq(limitChangeSessions.id, sessionId))
      .run();

    const result = await refreshLimitChangeState(
      db,
      verdictClient(authVerdict("s")),
      { ...poll, sessionId },
    );
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("verification_failed");
  });
});

/** Drives a session all the way to `verified` by anna's own authenticator. */
async function verifiedSession(now = Date.now()): Promise<string> {
  giveAuthenticator("user_anna", "sub-anna");
  const sessionId = await openSession(now);
  await refreshLimitChangeState(
    db,
    verdictClient(authVerdict("sub-anna")),
    { ...poll, sessionId },
    now,
  );
  if (rowOf(sessionId)?.state !== "verified") {
    throw new Error("fixture did not reach verified");
  }
  return sessionId;
}

function setAccountLimit(cents: number, id = "acc_anna"): void {
  db.update(accounts)
    .set({ dailyLimitCents: cents })
    .where(eq(accounts.id, id))
    .run();
}

describe("applyLimitChange", () => {
  it("writes the new limit and consumes the session", async () => {
    const sessionId = await verifiedSession();
    const result = applyLimitChange(db, { ...poll, sessionId });

    expect(result).toEqual({ ok: true, dailyLimitCents: 200_000 });
    expect(accountLimit()).toBe(200_000);
    expect(rowOf(sessionId)?.state).toBe("applied");
  });

  it("refuses a session that is still pending", async () => {
    const sessionId = await openSession();
    expect(applyLimitChange(db, { ...poll, sessionId })).toEqual({
      ok: false,
      reason: "not_verified",
    });
    expect(accountLimit()).toBe(100_000);
  });

  it("refuses a failed session", async () => {
    const sessionId = await openSession();
    db.update(limitChangeSessions)
      .set({ state: "failed", failureReason: "wrong_customer" })
      .where(eq(limitChangeSessions.id, sessionId))
      .run();

    expect(applyLimitChange(db, { ...poll, sessionId })).toEqual({
      ok: false,
      reason: "not_verified",
    });
    expect(accountLimit()).toBe(100_000);
  });

  /** Review Focus 5. */
  it("refuses a second apply", async () => {
    const sessionId = await verifiedSession();
    applyLimitChange(db, { ...poll, sessionId });
    expect(applyLimitChange(db, { ...poll, sessionId })).toEqual({
      ok: false,
      reason: "already_applied",
    });
  });

  it("writes the limit exactly once", async () => {
    // The replay happens with the account back AT THE SNAPSHOT, so the
    // stale-snapshot gate cannot refuse it and only the `applied` guard can.
    // The first version of this test left the account at 500_000, where the
    // snapshot gate alone would have refused the replay even with the single-
    // use guard deleted — it was green for the wrong reason. Found by the
    // final review.
    const sessionId = await verifiedSession();
    applyLimitChange(db, { ...poll, sessionId });
    expect(accountLimit()).toBe(200_000);

    setAccountLimit(100_000);
    expect(applyLimitChange(db, { ...poll, sessionId })).toEqual({
      ok: false,
      reason: "already_applied",
    });
    expect(accountLimit()).toBe(100_000);
  });

  /**
   * Review Focus 2 — two dialogs open on one account.
   *
   * `old_limit_cents` is half of what the holder signed over. Applying
   * `new_limit_cents` against an account that has since moved would honour an
   * approval of a transition that is no longer the one happening.
   */
  it("refuses to apply against a stale snapshot", async () => {
    const sessionId = await verifiedSession();
    setAccountLimit(500_000);

    expect(applyLimitChange(db, { ...poll, sessionId })).toEqual({
      ok: false,
      reason: "limit_changed",
    });
    expect(accountLimit()).toBe(500_000);
  });

  it("leaves a stale-snapshot session claimable rather than consuming it", async () => {
    // The gate must come BEFORE the guarded write, or a refused apply burns
    // the session and the holder's approval is lost for nothing.
    const sessionId = await verifiedSession();
    setAccountLimit(500_000);
    applyLimitChange(db, { ...poll, sessionId });

    expect(rowOf(sessionId)?.state).toBe("verified");
    setAccountLimit(100_000);
    expect(applyLimitChange(db, { ...poll, sessionId })).toEqual({
      ok: true,
      dailyLimitCents: 200_000,
    });
  });

  it("refuses an expired session", async () => {
    const now = Date.now();
    const sessionId = await verifiedSession(now);
    expect(
      applyLimitChange(
        db,
        { ...poll, sessionId },
        now + LIMIT_CHANGE_SESSION_TTL_MS + 1,
      ),
    ).toEqual({ ok: false, reason: "expired" });
    expect(accountLimit()).toBe(100_000);
  });

  /** Review Focus 4 — all three answer the same 404 at the route. */
  it("refuses another user's session", async () => {
    const sessionId = await verifiedSession();
    expect(
      applyLimitChange(db, {
        userId: "user_ben",
        accountId: "acc_anna",
        sessionId,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(accountLimit()).toBe(100_000);
  });

  it("refuses the right session under the wrong account", async () => {
    const sessionId = await verifiedSession();
    expect(
      applyLimitChange(db, { ...poll, accountId: "acc_ben", sessionId }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a nonexistent session", async () => {
    expect(
      applyLimitChange(db, { ...poll, sessionId: "limit_nope" }),
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("touches no other account", async () => {
    const sessionId = await verifiedSession();
    applyLimitChange(db, { ...poll, sessionId });
    expect(accountLimit("acc_ben")).toBe(100_000);
  });
});

describe("relayLimitChangeDcApiResponse", () => {
  /** Captures the relayed body so the verification id can be asserted. */
  function relayClient(
    captures: Capture[],
    status = 200,
  ): FoundryClient {
    const fetchImpl = (async (
      relayInput: string | URL | Request,
      init?: RequestInit,
    ) => {
      captures.push({
        url: String(relayInput),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({ verified: true, checks: [], credentials: [] }),
        { status, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    return new FoundryClient({
      adminUrl: "http://f:9000",
      adminKey: "k",
      fetchImpl,
    });
  }

  it("relays the wallet response to foundry", async () => {
    const sessionId = await openSession();
    const captures: Capture[] = [];
    const result = await relayLimitChangeDcApiResponse(
      db,
      relayClient(captures),
      { ...poll, sessionId, response: "jwe" },
    );

    expect(result).toEqual({ ok: true });
    expect(captures).toHaveLength(1);
    expect(captures[0]!.url).toBe(
      "http://f:9000/admin/verification/requests/v_limit_1/dc-api-response",
    );
    expect(captures[0]!.body).toEqual({ response: "jwe" });
  });

  it("refuses to relay another user's session", async () => {
    const sessionId = await openSession();
    const captures: Capture[] = [];
    const result = await relayLimitChangeDcApiResponse(
      db,
      relayClient(captures),
      {
        userId: "user_ben",
        accountId: "acc_anna",
        sessionId,
        response: "jwe",
      },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(captures).toHaveLength(0);
  });

  it("refuses the right session under the wrong account", async () => {
    const sessionId = await openSession();
    const result = await relayLimitChangeDcApiResponse(db, relayClient([]), {
      ...poll,
      accountId: "acc_ben",
      sessionId,
      response: "jwe",
    });
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("reports a session foundry never gave a verification id", async () => {
    const sessionId = await openSession();
    db.update(limitChangeSessions)
      .set({ foundryVerificationId: null })
      .where(eq(limitChangeSessions.id, sessionId))
      .run();

    const result = await relayLimitChangeDcApiResponse(db, relayClient([]), {
      ...poll,
      sessionId,
      response: "jwe",
    });
    expect(result).toEqual({ ok: false, reason: "no_verification" });
  });

  it("reports foundry being unreachable", async () => {
    const sessionId = await openSession();
    const result = await relayLimitChangeDcApiResponse(
      db,
      relayClient([], 500),
      { ...poll, sessionId, response: "jwe" },
    );
    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
  });

  it("writes no state of its own — the poll is the single state path", async () => {
    const sessionId = await openSession();
    await relayLimitChangeDcApiResponse(db, relayClient([]), {
      ...poll,
      sessionId,
      response: "jwe",
    });
    expect(rowOf(sessionId)?.state).toBe("pending");
  });
});
