import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DC_API_ISSUANCE_PROTOCOL,
  DC_API_PRESENTATION_PROTOCOL,
  invokeDcCreate,
  isDcApiNotSupportedError,
  prepareDcApiRequest,
  supportsDcApi,
  type DcApiGlobals,
} from "./dcApi.js";

/** A globals object that satisfies every check, so each test can break one. */
function fullSupport(allows = true): DcApiGlobals {
  return {
    isSecureContext: true,
    DigitalCredential: { userAgentAllowsProtocol: () => allows },
    navigator: {
      credentials: { get: () => undefined, create: () => undefined },
    },
  };
}

describe("supportsDcApi", () => {
  it("is true for get when every condition holds", () => {
    expect(
      supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, fullSupport()),
    ).toBe(true);
  });

  it("is false outside a secure context", () => {
    const g = fullSupport();
    g.isSecureContext = false;
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when DigitalCredential is absent", () => {
    const g = fullSupport();
    delete g.DigitalCredential;
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when navigator.credentials is absent", () => {
    const g = fullSupport();
    g.navigator = {};
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when the requested method is not a function", () => {
    const g = fullSupport();
    g.navigator = { credentials: { create: () => undefined } };
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is false when userAgentAllowsProtocol says no", () => {
    expect(
      supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, fullSupport(false)),
    ).toBe(false);
  });

  it("is false when userAgentAllowsProtocol throws", () => {
    const g = fullSupport();
    g.DigitalCredential = {
      userAgentAllowsProtocol: () => {
        throw new Error("boom");
      },
    };
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(false);
  });

  it("is true when userAgentAllowsProtocol is absent entirely", () => {
    const g = fullSupport();
    g.DigitalCredential = {};
    expect(supportsDcApi("get", DC_API_PRESENTATION_PROTOCOL, g)).toBe(true);
  });

  // Spec D4: create is lenient because openid4vci-v1 is a Chrome origin-trial
  // identifier that a capable browser may still answer false for.
  it("skips the protocol probe for create where get would fail", () => {
    const g = fullSupport(false);
    expect(supportsDcApi("get", DC_API_ISSUANCE_PROTOCOL, g)).toBe(false);
    expect(supportsDcApi("create", DC_API_ISSUANCE_PROTOCOL, g)).toBe(true);
  });

  it("still requires a secure context and DigitalCredential for create", () => {
    const noSecure = fullSupport();
    noSecure.isSecureContext = false;
    expect(supportsDcApi("create", DC_API_ISSUANCE_PROTOCOL, noSecure)).toBe(
      false,
    );

    const noDc = fullSupport();
    delete noDc.DigitalCredential;
    expect(supportsDcApi("create", DC_API_ISSUANCE_PROTOCOL, noDc)).toBe(false);
  });
});

describe("isDcApiNotSupportedError", () => {
  it("recognises NotSupportedError by name", () => {
    const err = new Error("nope");
    err.name = "NotSupportedError";
    expect(isDcApiNotSupportedError(err)).toBe(true);
  });

  it("recognises a TypeError whose message says not supported", () => {
    const err = new TypeError("digital is not supported");
    expect(isDcApiNotSupportedError(err)).toBe(true);
  });

  it("recognises a CredentialContainer message", () => {
    expect(
      isDcApiNotSupportedError(new Error("CredentialContainer has no get")),
    ).toBe(true);
  });

  it("rejects an unrelated error", () => {
    expect(isDcApiNotSupportedError(new Error("user cancelled"))).toBe(false);
  });

  it("rejects a plain TypeError with an unrelated message", () => {
    expect(isDcApiNotSupportedError(new TypeError("x is undefined"))).toBe(
      false,
    );
  });

  it("tolerates non-Error inputs", () => {
    expect(isDcApiNotSupportedError(null)).toBe(false);
    expect(isDcApiNotSupportedError("NotSupportedError")).toBe(false);
    expect(isDcApiNotSupportedError(undefined)).toBe(false);
  });
});

describe("prepareDcApiRequest", () => {
  it("wraps the payload in the digital credentials envelope", () => {
    expect(prepareDcApiRequest({ a: 1 }, DC_API_ISSUANCE_PROTOCOL)).toEqual({
      digital: { requests: [{ protocol: "openid4vci-v1", data: { a: 1 } }] },
    });
  });
});

describe("protocol constants", () => {
  it("uses the exact identifiers foundry and Chrome expect", () => {
    expect(DC_API_ISSUANCE_PROTOCOL).toBe("openid4vci-v1");
    expect(DC_API_PRESENTATION_PROTOCOL).toBe("openid4vp-v1-unsigned");
  });
});
/**
 * Regression: Safari 26 ships the DC API for PRESENTATION only, so it has both
 * `DigitalCredential` and (via WebAuthn) `navigator.credentials.create` — which
 * is everything `supportsDcApi("create", …)` looks at before its lenient
 * short-circuit. The bank therefore renders the DC API button, and the click
 * resolved with `null` instead of throwing. Measured in real Safari 26.5.2:
 * `CREATE RESOLVED: null`. With non-throw treated as success that click was a
 * silent no-op forever — no error, and never the QR fallback.
 */
describe("invokeDcCreate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubCreate(impl: () => Promise<unknown>) {
    vi.stubGlobal("navigator", { credentials: { create: impl } });
  }

  const req = prepareDcApiRequest({}, DC_API_ISSUANCE_PROTOCOL);

  it("rejects when create resolves null, so the QR fallback can fire", async () => {
    stubCreate(() => Promise.resolve(null));
    await expect(invokeDcCreate(req)).rejects.toThrow();
  });

  it("reports a null resolution as unsupported rather than cancelled", async () => {
    stubCreate(() => Promise.resolve(null));
    const err = await invokeDcCreate(req).catch((e: unknown) => e);
    expect(isDcApiNotSupportedError(err)).toBe(true);
  });

  it("rejects when create resolves undefined", async () => {
    stubCreate(() => Promise.resolve(undefined));
    await expect(invokeDcCreate(req)).rejects.toThrow();
  });

  /**
   * Load-bearing: the assertion must stay a null check and never become a
   * return-SHAPE assertion like invokeDcGet's. Chrome's documented issuance
   * example ignores create()'s return value, so demanding a `DigitalCredential`
   * here would manufacture failures on a successful handover.
   */
  it("resolves for any non-null return, whatever its shape", async () => {
    stubCreate(() => Promise.resolve({ nothing: "recognisable" }));
    await expect(invokeDcCreate(req)).resolves.toBeUndefined();
  });

  it("propagates a genuine throw unchanged", async () => {
    const boom = new DOMException("no wallet", "NotAllowedError");
    stubCreate(() => Promise.reject(boom));
    await expect(invokeDcCreate(req)).rejects.toBe(boom);
  });
});
