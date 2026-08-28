import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwsCompact, decodeVpToken } from "./proof-decode.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** base64url with no padding, exactly as JOSE requires. */
function b64u(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jws(header: unknown, payload: unknown, signature = "c2ln"): string {
  return `${b64u(header)}.${b64u(payload)}.${signature}`;
}

describe("decodeJwsCompact", () => {
  it("splits a compact JWS into header, payload and signature", () => {
    const token = jws({ alg: "ES256", typ: "dc+sd-jwt" }, { vct: "com.emvco.dpc.card" });

    expect(decodeJwsCompact(token)).toEqual({
      ok: true,
      header: { alg: "ES256", typ: "dc+sd-jwt" },
      payload: { vct: "com.emvco.dpc.card" },
      // Left encoded: it is a signature over bytes, not a document. Rendering
      // it as text would invite someone to read it as one.
      signature: "c2ln",
    });
  });

  it("fails on a token that is not three segments", () => {
    expect(decodeJwsCompact("a.b")).toEqual({ ok: false, reason: expect.any(String) });
    expect(decodeJwsCompact("a.b.c.d").ok).toBe(false);
    expect(decodeJwsCompact("").ok).toBe(false);
  });

  it("fails on a segment that is not base64url", () => {
    // Buffer.from(_, "base64url") SILENTLY SKIPS invalid characters rather than
    // throwing, so the alphabet has to be checked explicitly. Without that this
    // returns a plausible-looking wrong answer.
    expect(decodeJwsCompact(`${b64u({ a: 1 })}.not+base64url/.sig`).ok).toBe(false);
  });

  it("fails on base64url that is not JSON", () => {
    const notJson = Buffer.from("hello").toString("base64url");
    expect(decodeJwsCompact(`${notJson}.${b64u({ a: 1 })}.sig`).ok).toBe(false);
  });

  it("never throws on arbitrary input", () => {
    for (const input of ["~~~", "...", "🙂.🙂.🙂", "a".repeat(10_000)]) {
      expect(() => decodeJwsCompact(input)).not.toThrow();
    }
  });

  it("decodes with no Node globals at all", () => {
    // THIS FILE'S ONLY CONSUMER IS A BROWSER. `ProofDialog` is a client
    // component, so every line of this module runs where `Buffer` does not
    // exist — and a `Buffer` reference inside the existing try/catch does not
    // crash, it degrades to "could not decode base64url" on EVERY artefact.
    // That is a silent total no-op, and it shipped once: the whole dialog read
    // "Could not be decoded — shown as received" against a package this suite
    // was decoding perfectly.
    //
    // vitest is `environment: "node"`, so Buffer is present here and cannot
    // reveal the defect. Removing it is the only way to run this module the
    // way the browser does.
    // Built BEFORE the stub: this file's own `b64u` helper uses Buffer too,
    // and encoding after the stub fails in the fixture rather than in the
    // code under test.
    const token = jws({ alg: "ES256" }, { vct: "sparkassencard" });
    vi.stubGlobal("Buffer", undefined);

    expect(decodeJwsCompact(token)).toMatchObject({
      ok: true,
      header: { alg: "ES256" },
      payload: { vct: "sparkassencard" },
    });
  });

  it("decodes multi-byte UTF-8 without Buffer", () => {
    // `atob` yields a BINARY string, one char per byte. Reading it as text
    // mangles every non-ASCII claim — a holder called "Müller" becomes
    // "MÃ¼ller" — so the bytes must go through a UTF-8 decoder.
    const token = jws({ alg: "ES256" }, { name: "Müller", city: "Köln" });
    vi.stubGlobal("Buffer", undefined);

    expect(decodeJwsCompact(token)).toMatchObject({
      ok: true,
      payload: { name: "Müller", city: "Köln" },
    });
  });
});

describe("decodeVpToken", () => {
  const issuer = jws({ alg: "ES256", typ: "dc+sd-jwt" }, { vct: "sparkassencard" });
  const kb = jws({ alg: "ES256", typ: "kb+jwt" }, { aud: "x509_hash:abc" });
  const disclosure = Buffer.from(
    JSON.stringify(["c2FsdA", "psu_id", "psu-1"]),
  ).toString("base64url");

  it("keys presentations by their DCQL query id", () => {
    const view = decodeVpToken({ sparkassencard: [`${issuer}~${disclosure}~`] });
    expect(view.ok).toBe(true);
    if (!view.ok) return;

    expect(view.entries.map((e) => e.queryId)).toEqual(["sparkassencard"]);
    expect(view.entries[0]!.presentations).toHaveLength(1);
  });

  it("splits an SD-JWT into issuer JWT, disclosures and no KB-JWT", () => {
    // A TRAILING tilde means "no key binding". The last segment is empty, not
    // a JWT, and treating it as one is the classic SD-JWT parsing bug.
    const view = decodeVpToken({ dpc: [`${issuer}~${disclosure}~`] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.issuerJwt.ok).toBe(true);
    expect(p.disclosures).toEqual([{ ok: true, value: ["c2FsdA", "psu_id", "psu-1"] }]);
    expect(p.kbJwt).toBeNull();
  });

  it("reads a KB-JWT when the presentation carries one", () => {
    const view = decodeVpToken({ dpc: [`${issuer}~${disclosure}~${kb}`] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.kbJwt?.ok).toBe(true);
    expect(p.disclosures).toHaveLength(1);
  });

  it("handles an SD-JWT with no disclosures at all", () => {
    const view = decodeVpToken({ dpc: [issuer] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.disclosures).toEqual([]);
    expect(p.kbJwt).toBeNull();
  });

  it("reports a malformed disclosure without discarding the good ones", () => {
    const view = decodeVpToken({ dpc: [`${issuer}~${disclosure}~!!!~`] });
    if (!view.ok) throw new Error("expected ok");

    const p = view.entries[0]!.presentations[0]!;
    if (p.kind !== "sd-jwt") throw new Error("expected sd-jwt");
    expect(p.disclosures[0]!.ok).toBe(true);
    expect(p.disclosures[1]!.ok).toBe(false);
  });

  it("renders an mdoc presentation as opaque rather than guessing", () => {
    // An mso_mdoc presentation is base64url CBOR. It has no dots and is not
    // JSON, and a decoder that tried anyway would print convincing nonsense.
    const view = decodeVpToken({ av_mdoc: ["omdkb2NUeXBlZ2V1LmV1"] });
    if (!view.ok) throw new Error("expected ok");

    expect(view.entries[0]!.presentations[0]).toEqual({
      kind: "opaque",
      value: "omdkb2NUeXBlZ2V1LmV1",
    });
  });

  it("keeps two credentials apart", () => {
    const view = decodeVpToken({ dpc: [issuer], av_sdjwt: [issuer] });
    if (!view.ok) throw new Error("expected ok");
    expect(view.entries.map((e) => e.queryId).sort()).toEqual(["av_sdjwt", "dpc"]);
  });

  it("fails on a vp_token that is not an object keyed by query id", () => {
    expect(decodeVpToken(null).ok).toBe(false);
    expect(decodeVpToken("eyJ...").ok).toBe(false);
    expect(decodeVpToken([]).ok).toBe(false);
  });

  it("accepts an empty vp_token object", () => {
    const view = decodeVpToken({});
    expect(view).toEqual({ ok: true, entries: [] });
  });

  it("reports a non-array entry rather than throwing", () => {
    // OpenID4VP 1.0 makes each value an ARRAY of presentations. A wallet that
    // sent a bare string is wrong, and the viewer must say so rather than crash.
    const view = decodeVpToken({ dpc: issuer });
    expect(view.ok).toBe(false);
  });

  it("never throws on arbitrary input", () => {
    for (const input of [undefined, 0, true, { dpc: [null] }, { dpc: [{}] }]) {
      expect(() => decodeVpToken(input)).not.toThrow();
    }
  });
});