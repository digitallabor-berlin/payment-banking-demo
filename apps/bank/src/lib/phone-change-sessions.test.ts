import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FoundryClient } from "@demo/foundry-client";
import { createDb, type Db } from "../db/index.js";
import { credentials, phoneChangeSessions, users } from "../db/schema.js";
import { seed } from "../db/seed.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "./credential-types.js";
import {
  PHONE_CHANGE_SESSION_TTL_MS,
  getPhoneChangeStatus,
  refreshPhoneChangeState,
  startPhoneChange,
} from "./phone-change-sessions.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-phone-"));
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
    verification_id: "v_phone_1",
    openid4vp_uri: "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    request_uri: "https://f/req/1",
  },
};

const DC_API_SIGNED_OK: Reply = {
  status: 200,
  body: {
    verification_id: "v_phone_2",
    dc_api_request: { request: "eyJ0.eyJ1.sig" },
    protocol: "openid4vp-v1-signed",
  },
};

function onlyRow() {
  return db.select().from(phoneChangeSessions).get();
}

function phoneOf(userId: string): string | undefined {
  return db.select().from(users).where(eq(users.id, userId)).get()?.phoneNumber;
}

function mintCalls(captures: Capture[]) {
  return captures.filter((c) => c.url.includes("/admin/paso/ad-hoc-metadata"));
}

function verifyCalls(captures: Capture[]) {
  return captures.filter((c) => c.url.includes("/admin/verification/requests"));
}

/** The one `transaction_data` entry of a captured verification request. */
function entryOf(capture: Capture) {
  return (capture.body.transaction_data as Array<Record<string, unknown>>)[0]!;
}

/**
 * The happy-path input: anna moving off the number the fixtures gave her.
 *
 * No `transport`, so these cases exercise the default — `request_uri`, which
 * works in every browser. The cases that name one spread it in.
 */
const input = {
  userId: "user_anna",
  phoneNumber: "+49 172 66666666",
};

/**
 * A foundry verdict naming one Sparkassen Authenticator credential.
 *
 * `bound` is a parameter rather than always true because the binding gate is
 * one of the four, and every `verified` case has to be able to carry a passing
 * one — leave it out and adding the gate reads as six regressions rather than
 * one stale fixture.
 */
function authVerdict(sub: unknown, verified = true, bound = true) {
  return {
    id: "v_phone_1",
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

/** A verdict in which NO credential answered the authenticator query. */
function emptyVerdict() {
  return {
    id: "v_phone_1",
    state: "verified",
    created_at: 0,
    result: { verified: true, checks: [], credentials: [] },
  };
}

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

async function openSession(now = Date.now()): Promise<string> {
  const result = await startPhoneChange(
    db,
    stubClient([], { mint: MINT_OK, verify: REQUEST_URI_OK }),
    input,
    now,
  );
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.session.sessionId;
}

function giveAuthenticator(userId: string, sub: string, state = "active"): void {
  db.insert(credentials)
    .values({
      id: `cred_${sub}`,
      userId,
      cardId: null,
      credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
      credentialId: sub,
      state: state as "active" | "offered" | "failed",
      createdAt: 1,
    })
    .run();
}

const poll = { userId: "user_anna" };

describe("refreshPhoneChangeState scoping", () => {
  it("answers not_found for another customer's session", async () => {
    const sessionId = await openSession();
    const calls: string[] = [];
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("s"), calls),
      { userId: "user_ben", sessionId },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    // The id is guessable and this flow writes to a customer's row, so "not
    // yours" and "does not exist" must be the same answer — and neither may
    // cost foundry traffic.
    expect(calls).toHaveLength(0);
  });

  it("answers not_found for a session that does not exist", async () => {
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("s")),
      { ...poll, sessionId: "phone_nope" },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("getPhoneChangeStatus is scoped the same two ways", async () => {
    const sessionId = await openSession();

    expect(getPhoneChangeStatus(db, "user_anna", sessionId)).toEqual({
      state: "pending",
      newPhone: "+49 172 66666666",
    });
    expect(getPhoneChangeStatus(db, "user_ben", sessionId)).toBeNull();
    expect(getPhoneChangeStatus(db, "user_anna", "phone_nope")).toBeNull();
  });
});

describe("refreshPhoneChangeState", () => {
  it("makes no foundry call for an applied or failed session", async () => {
    for (const state of ["applied", "failed"] as const) {
      const sessionId = await openSession();
      db.update(phoneChangeSessions)
        .set({ state })
        .where(eq(phoneChangeSessions.id, sessionId))
        .run();

      const calls: string[] = [];
      const result = await refreshPhoneChangeState(
        db,
        verdictClient(authVerdict("s"), calls),
        { ...poll, sessionId },
      );

      expect(result).toMatchObject({ ok: true, status: { state } });
      expect(calls).toHaveLength(0);
    }
  });

  it("fails with expired past the TTL, without calling foundry", async () => {
    const sessionId = await openSession(1000);
    const calls: string[] = [];
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...poll, sessionId },
      1000 + PHONE_CHANGE_SESSION_TTL_MS + 1,
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.state).toBe("failed");
    expect(result.status.failureReason).toBe("expired");
    // An abandoned tab must stop costing admin-API traffic the moment its
    // window closes.
    expect(calls).toHaveLength(0);
  });

  it("makes no foundry call for a session already verified", async () => {
    const sessionId = await openSession();
    db.update(phoneChangeSessions)
      .set({ state: "verified" })
      .where(eq(phoneChangeSessions.id, sessionId))
      .run();

    const calls: string[] = [];
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("s"), calls),
      { ...poll, sessionId },
    );

    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
    expect(calls).toHaveLength(0);
  });

  it("stays pending when getVerificationStatus throws", async () => {
    const sessionId = await openSession();
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("s"), [], 503),
      { ...poll, sessionId },
    );

    // Transient. One 503 inside a five-minute window must not destroy an
    // approval; the client's consecutive-failure counter gives up, not this.
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.state).toBe("pending");
    expect(result.status.failureReason).toBeUndefined();
  });

  it("stays pending while foundry reports pending", async () => {
    const sessionId = await openSession();
    const result = await refreshPhoneChangeState(
      db,
      verdictClient({ id: "v_phone_1", state: "pending", created_at: 0 }),
      { ...poll, sessionId },
    );

    expect(result).toMatchObject({ ok: true, status: { state: "pending" } });
  });

  it("fails with verification_failed when foundry reports failed", async () => {
    const sessionId = await openSession();
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("s", false)),
      { ...poll, sessionId },
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.state).toBe("failed");
    expect(result.status.failureReason).toBe("verification_failed");
  });

  it("fails with verification_failed when verified is not true", async () => {
    const sessionId = await openSession();
    const verdict = authVerdict("s");
    verdict.result.verified = false as unknown as true;
    const result = await refreshPhoneChangeState(
      db,
      verdictClient({ ...verdict, state: "verified" }),
      { ...poll, sessionId },
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("verification_failed");
  });

  it("fails with verification_failed when no credential answered", async () => {
    const sessionId = await openSession();
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(emptyVerdict()),
      { ...poll, sessionId },
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("verification_failed");
  });

  it("fails with transaction_data_binding_failed when the binding did not pass", async () => {
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("sub_anna", true, false)),
      { ...poll, sessionId },
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.state).toBe("failed");
    expect(result.status.failureReason).toBe(
      "transaction_data_binding_failed",
    );
  });

  /**
   * The ONLY input where the two orderings give different answers: a `sub` no
   * credential carries, plus a failing binding. Reading a claim out of a JSON
   * blob is inert; turning it into a customer is the act, so the binding gate
   * sits between the read and the resolve.
   */
  it("gates the binding BEFORE resolving the sub", async () => {
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("sub_nobody_carries", true, false)),
      { ...poll, sessionId },
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe(
      "transaction_data_binding_failed",
    );
  });

  it("fails with unknown_credential for a sub this bank cannot place", async () => {
    const sessionId = await openSession();
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("sub_nobody_carries")),
      { ...poll, sessionId },
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.failureReason).toBe("unknown_credential");
  });

  /**
   * THE gate this flow adds over wallet login. Without it any valid Sparkassen
   * Authenticator presentation could change any signed-in customer's number.
   */
  it("fails with wrong_customer for another customer's authenticator", async () => {
    const sessionId = await openSession();
    giveAuthenticator("user_ben", "sub_ben");
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("sub_ben")),
      { ...poll, sessionId },
    );

    if (!result.ok) throw new Error("expected ok");
    expect(result.status.state).toBe("failed");
    // Its OWN reason, distinct from unknown_credential, so an operator can
    // tell a credential issued to the wrong person from one the bank cannot
    // place at all. The holder sees the same generic copy for both.
    expect(result.status.failureReason).toBe("wrong_customer");
  });

  it("verifies and records approvedByUserId on a good presentation", async () => {
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("sub_anna")),
      { ...poll, sessionId },
    );

    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
    const row = onlyRow();
    expect(row?.state).toBe("verified");
    expect(row?.approvedByUserId).toBe("user_anna");
    // And nothing is written yet: apply does that.
    expect(phoneOf("user_anna")).toBe("+49 171 5555555");
  });

  it("does not require the credential row to be active", async () => {
    // foundry's verdict is the authority that the credential is real and
    // holder-bound; the row only answers WHOSE. Nothing here clears an
    // `offered` row, so gating on state would refuse a working credential.
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna", "offered");
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("sub_anna")),
      { ...poll, sessionId },
    );

    expect(result).toMatchObject({ ok: true, status: { state: "verified" } });
  });

  it("carries newPhone on the status so the dialog can name it", async () => {
    const sessionId = await openSession();
    giveAuthenticator("user_anna", "sub_anna");
    const result = await refreshPhoneChangeState(
      db,
      verdictClient(authVerdict("sub_anna")),
      { ...poll, sessionId },
    );

    // By the time the dialog renders success the only thing it still holds is
    // a session id, and the success line names the number.
    if (!result.ok) throw new Error("expected ok");
    expect(result.status.newPhone).toBe("+49 172 66666666");
  });
});

describe("startPhoneChange ownership and validation", () => {
  it("refuses an unknown user with not_found and writes nothing", async () => {
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, userId: "user_nobody" },
    );

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(captures).toHaveLength(0);
    expect(onlyRow()).toBeUndefined();
  });

  it("refuses a malformed number with invalid_phone, before any write or traffic", async () => {
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, phoneNumber: "0171 5555555" },
    );

    expect(result).toEqual({ ok: false, reason: "invalid_phone" });
    // Both halves matter: a caller with curl must not be able to make the bank
    // talk to foundry, nor leave a row behind, with a string it has rejected.
    expect(captures).toHaveLength(0);
    expect(onlyRow()).toBeUndefined();
  });

  it("refuses a non-string number with invalid_phone", async () => {
    for (const phoneNumber of [491715555555, null, {}, [], true]) {
      const captures: Capture[] = [];
      const result = await startPhoneChange(
        db,
        stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
        { ...input, phoneNumber },
      );

      expect(result).toEqual({ ok: false, reason: "invalid_phone" });
      expect(captures).toHaveLength(0);
    }
    expect(onlyRow()).toBeUndefined();
  });

  /**
   * The gate that makes the consent screen mean something. Without it the
   * wallet would ask a human to approve a change from `+49 171 5555555` to
   * `+491715555555` — two renderings of one number.
   */
  it("refuses the same number in a different format with phone_unchanged", async () => {
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, phoneNumber: "+491715555555" },
    );

    expect(result).toEqual({ ok: false, reason: "phone_unchanged" });
    expect(captures).toHaveLength(0);
    expect(onlyRow()).toBeUndefined();
  });
});

describe("startPhoneChange", () => {
  it("writes a pending row before calling foundry", async () => {
    // The mint fails, so nothing after the first write can have run — and a
    // row still exists naming the attempted transport.
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: { status: 503, body: {} } }),
      { ...input, transport: "dc_api_signed" },
    );

    expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
    const row = onlyRow();
    expect(row).toBeDefined();
    expect(row?.startedByUserId).toBe("user_anna");
    expect(row?.state).toBe("failed");
  });

  it("stores the NORMALISED number, not the raw input", async () => {
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, phoneNumber: "  +49 172  66666666 " },
    );

    expect(result.ok).toBe(true);
    expect(onlyRow()?.newPhone).toBe("+49 172 66666666");
    // And the signed payload agrees with the column, byte for byte — a
    // mismatch here is an artefact the holder signed that the bank did not
    // store.
    expect(
      (entryOf(verifyCalls(captures)[0]!).payload as Record<string, string>)
        .new_phone,
    ).toBe("+49 172 66666666");
  });

  it("snapshots the user's current number as oldPhone", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(onlyRow()?.oldPhone).toBe("+49 171 5555555");
    expect(
      (entryOf(verifyCalls(captures)[0]!).payload as Record<string, string>)
        .old_phone,
    ).toBe("+49 171 5555555");
  });

  it("never writes the user's number", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    // Starting a session is not applying one. The number moves in
    // `applyPhoneChange` and nowhere else.
    expect(phoneOf("user_anna")).toBe("+49 171 5555555");
  });

  it("mints the metadata BEFORE creating the verification request", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(captures).toHaveLength(2);
    expect(captures[0]?.url).toContain("/admin/paso/ad-hoc-metadata");
    expect(captures[1]?.url).toContain("/admin/verification/requests");
  });

  it("creates NO verification request when the mint throws", async () => {
    // The verification request is scripted as a perfectly good 200, so the
    // ONLY thing that can stop it is the code.
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, {
        mint: { status: 503, body: { error: "down" } },
        verify: REQUEST_URI_OK,
      }),
      input,
    );

    expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
    expect(mintCalls(captures)).toHaveLength(1);
    expect(verifyCalls(captures)).toHaveLength(0);
  });

  /**
   * A 2xx is not a successful mint. `FoundryClient.request` does
   * `JSON.parse(text) as T` and throws only on a non-2xx or a non-JSON body,
   * so a 200 carrying `{}` leaves `jwt` undefined with nothing raised — and
   * `JSON.stringify` would then DROP `metadata` from the entry silently.
   * foundry accepts an entry with no `metadata` at HTTP 200 (measured), so the
   * anti-goal would ship looking like success.
   */
  it("creates NO verification request when the mint returns 200 with no jwt", async () => {
    for (const body of [{}, { jwt: "" }, { token: "a.b.c" }, null]) {
      const captures: Capture[] = [];
      const result = await startPhoneChange(
        db,
        stubClient(captures, {
          mint: { status: 200, body },
          verify: REQUEST_URI_OK,
        }),
        input,
      );

      expect(result).toEqual({ ok: false, reason: "metadata_unavailable" });
      expect(verifyCalls(captures)).toHaveLength(0);
    }
  });

  it("fails the row with metadata_unavailable when the mint fails", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, {
        mint: { status: 500, body: {} },
        verify: REQUEST_URI_OK,
      }),
      input,
    );

    const row = onlyRow();
    expect(row?.state).toBe("failed");
    expect(row?.failureReason).toBe("metadata_unavailable");
  });

  it("sends the minted jwt as the entry's metadata", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(entryOf(verifyCalls(captures)[0]!).metadata).toBe(
      "minted.jwt.value",
    );
  });

  it("names the sparkassen_auth named query", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(verifyCalls(captures)[0]?.body.named_query_ref).toBe(
      "sparkassen_auth",
    );
  });

  it("records the transport foundry ACTUALLY served", async () => {
    // Asked for dc_api_signed; foundry answered a request_uri with no inline
    // request object, which is what a build too old to know the transport
    // does. Recording the REQUESTED value would leave the dialog offering a
    // wallet button it cannot invoke while suppressing the QR that works.
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      { ...input, transport: "dc_api_signed" },
    );

    expect(onlyRow()?.transport).toBe("request_uri");
    expect(onlyRow()?.dcApiProtocol).toBeNull();
    expect(result.ok && result.session.transport).toBe("request_uri");
    expect(result.ok && result.session.dcApiProtocol).toBeNull();
    // The deep link, not the bare request_uri: `openid4vp_uri` is what a QR
    // encodes and what a phone can follow.
    expect(result.ok && result.session.uri).toBe(
      "openid4vp://?request_uri=https%3A%2F%2Ff%2Freq%2F1",
    );
  });

  it("records the inline request object when foundry serves one", async () => {
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: DC_API_SIGNED_OK }),
      { ...input, transport: "dc_api_signed" },
    );

    expect(onlyRow()?.transport).toBe("dc_api_signed");
    expect(onlyRow()?.dcApiProtocol).toBe("openid4vp-v1-signed");
    expect(result.ok && result.session.uri).toBeNull();
    expect(result.ok && result.session.dcApiRequest).toEqual({
      request: "eyJ0.eyJ1.sig",
    });
  });

  it("records the ATTEMPTED transport on a failed row", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, {
        mint: MINT_OK,
        verify: { status: 503, body: {} },
      }),
      { ...input, transport: "dc_api_signed" },
    );

    const row = onlyRow();
    expect(row?.state).toBe("failed");
    expect(row?.transport).toBe("dc_api_signed");
  });

  /**
   * The start route returns this value STRAIGHT THROUGH. `JSON.stringify`
   * silently drops an `undefined` member, which no type can catch, and an
   * absent member is exactly the defect this repo shipped once (6e997da).
   */
  it("returns a DTO with exactly the eight documented members", async () => {
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.session)).toEqual([
      "sessionId",
      "uri",
      "transport",
      "dcApiRequest",
      "dcApiProtocol",
      "state",
      "oldPhone",
      "newPhone",
    ]);
    expect(result.ok && result.session.state).toBe("pending");
    expect(result.ok && result.session.oldPhone).toBe("+49 171 5555555");
    expect(result.ok && result.session.newPhone).toBe("+49 172 66666666");
    expect(result.ok && result.session.sessionId).toMatch(/^phone_/);
  });

  it("fails with foundry_unavailable when the verification request throws", async () => {
    const captures: Capture[] = [];
    const result = await startPhoneChange(
      db,
      stubClient(captures, {
        mint: MINT_OK,
        verify: { status: 503, body: {} },
      }),
      input,
    );

    expect(result).toEqual({ ok: false, reason: "foundry_unavailable" });
    expect(onlyRow()?.failureReason).toBe("foundry_unavailable");
  });

  it("defaults to request_uri when no transport is given", async () => {
    const captures: Capture[] = [];
    await startPhoneChange(
      db,
      stubClient(captures, { mint: MINT_OK, verify: REQUEST_URI_OK }),
      input,
    );

    expect(verifyCalls(captures)[0]?.body.transport).toBe("request_uri");
    expect(onlyRow()?.transport).toBe("request_uri");
  });
});