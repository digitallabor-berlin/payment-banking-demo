import { describe, expect, it } from "vitest";
import {
  DC_API_PRESENTATION_PROTOCOL,
  DC_API_PRESENTATION_PROTOCOL_SIGNED,
} from "@demo/ui";
import {
  isDcApiTransport,
  presentationProtocolFor,
  parseDcApiForm,
  resolveDcApiProtocol,
  selectTransport,
  type PresentationTransport,
} from "./transport.js";

describe("selectTransport", () => {
  // Signed is the DEFAULT DC API form, not an opt-in: the wallet authenticates
  // the verifier from the request object's signature and x5c chain rather than
  // from the browser's web PKI alone.
  it("chooses dc_api_signed when the browser supports the DC API", () => {
    expect(selectTransport(true, "signed")).toBe("dc_api_signed");
  });

  it("chooses the unsigned form when it was explicitly asked for", () => {
    expect(selectTransport(true, "unsigned")).toBe("dc_api");
  });

  it("chooses request_uri when the browser does not support the DC API", () => {
    expect(selectTransport(false, "signed")).toBe("request_uri");
    expect(selectTransport(false, "unsigned")).toBe("request_uri");
  });

  // `null` means detection has not resolved yet. Falling back to the QR
  // transport is the safe answer: it works everywhere.
  it("chooses request_uri when support is still unknown", () => {
    expect(selectTransport(null, "signed")).toBe("request_uri");
    expect(selectTransport(null, "unsigned")).toBe("request_uri");
  });
});

describe("parseDcApiForm", () => {
  it("opts out of signing only for the exact ?dcapi=unsigned value", () => {
    expect(parseDcApiForm("unsigned")).toBe("unsigned");
  });

  it("tolerates case and surrounding whitespace", () => {
    expect(parseDcApiForm(" UNSIGNED ")).toBe("unsigned");
  });

  it("defaults to signed when the param is absent", () => {
    expect(parseDcApiForm(null)).toBe("signed");
    expect(parseDcApiForm(undefined)).toBe("signed");
    expect(parseDcApiForm("")).toBe("signed");
  });

  // A typo must not silently downgrade the wire form. Anything unrecognised
  // means the default, and the default is the stronger of the two.
  it("defaults to signed for an unrecognised value", () => {
    expect(parseDcApiForm("signed")).toBe("signed");
    expect(parseDcApiForm("unsinged")).toBe("signed");
    expect(parseDcApiForm("dc_api")).toBe("signed");
  });
});

describe("isDcApiTransport", () => {
  // Mirrors foundry's VerificationTransaction::is_dc_api. Both DC API forms
  // inline their request object and return the wallet's response through the
  // relay; only `request_uri` produces a scannable URI. Every comparison that
  // asks "is this a DC API session" must go through here — a bare
  // `transport === "dc_api"` silently renders a QR for a signed session.
  it("is true for both DC API forms", () => {
    expect(isDcApiTransport("dc_api")).toBe(true);
    expect(isDcApiTransport("dc_api_signed")).toBe(true);
  });

  it("is false for request_uri", () => {
    expect(isDcApiTransport("request_uri")).toBe(false);
  });

  it("covers every transport the type admits", () => {
    const all: PresentationTransport[] = [
      "request_uri",
      "dc_api",
      "dc_api_signed",
    ];
    expect(all.filter(isDcApiTransport)).toEqual(["dc_api", "dc_api_signed"]);
  });
});

describe("presentationProtocolFor", () => {
  // transport.ts repeats these two spellings rather than importing them,
  // because @demo/ui's only export is a barrel that pulls in React components
  // and this module is imported by server-side code. That duplication is what
  // this test exists to pin.
  it("agrees with the identifiers @demo/ui defines", () => {
    expect(presentationProtocolFor("signed")).toBe(
      DC_API_PRESENTATION_PROTOCOL_SIGNED,
    );
    expect(presentationProtocolFor("unsigned")).toBe(
      DC_API_PRESENTATION_PROTOCOL,
    );
  });
});

describe("resolveDcApiProtocol", () => {
  // foundry's own value always wins: it decides the request-object shape, and
  // the identifier names that shape.
  it("returns the identifier foundry sent, verbatim", () => {
    expect(resolveDcApiProtocol("dc_api_signed", "openid4vp-v1-signed")).toBe(
      "openid4vp-v1-signed",
    );
    expect(resolveDcApiProtocol("dc_api", "openid4vp-v1-unsigned")).toBe(
      "openid4vp-v1-unsigned",
    );
  });

  // Never invents an identifier for the signed form. A foundry that omits
  // `protocol` also predates `dc_api_signed`, so it cannot have served a signed
  // request object — guessing here is how a signed payload would end up under
  // the unsigned identifier.
  it("refuses to guess for the signed transport", () => {
    expect(resolveDcApiProtocol("dc_api_signed", undefined)).toBeNull();
    expect(resolveDcApiProtocol("dc_api_signed", null)).toBeNull();
  });

  // The unsigned form is the one case where the omission is unambiguous: a
  // build old enough to lack the field has exactly one DC API shape to serve.
  it("defaults the unsigned transport to the unsigned identifier", () => {
    expect(resolveDcApiProtocol("dc_api", undefined)).toBe(
      "openid4vp-v1-unsigned",
    );
  });

  it("is null for request_uri, which performs no DC API invocation", () => {
    expect(resolveDcApiProtocol("request_uri", undefined)).toBeNull();
    expect(
      resolveDcApiProtocol("request_uri", "openid4vp-v1-signed"),
    ).toBeNull();
  });
});
