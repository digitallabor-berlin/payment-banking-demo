import { describe, expect, it } from "vitest";
import { FoundryClient, FoundryError } from "./client.js";

function stubFetch(
  status: number,
  body: unknown,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    capture?.(String(input), init ?? {});
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function makeClient(fetchImpl: typeof fetch): FoundryClient {
  return new FoundryClient({
    adminUrl: "http://foundry.test:9000",
    adminKey: "k-123",
    fetchImpl,
  });
}

describe("FoundryClient.createIssuanceOffer", () => {
  it("posts to /admin/issuance/offers with a bearer token and returns the offer", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        {
          transaction_id: "tx_1",
          credential_offer_uri: "openid-credential-offer://x",
          dc_api_offer: {},
        },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const res = await client.createIssuanceOffer({
      credential_type_id: "com.emvco.dpc.card",
      claims: { credential_id: "dpc_abc", network: "VISA" },
    });

    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers");
    expect(seenInit.method).toBe("POST");
    const headers = new Headers(seenInit.headers);
    expect(headers.get("authorization")).toBe("Bearer k-123");
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(seenInit.body))).toEqual({
      credential_type_id: "com.emvco.dpc.card",
      claims: { credential_id: "dpc_abc", network: "VISA" },
    });
    expect(res.transaction_id).toBe("tx_1");
    expect(res.credential_offer_uri).toBe("openid-credential-offer://x");
  });

  /**
   * The two DPC display arrays must reach foundry byte-identical: it validates
   * them structurally (`display_metadata.rs`) and rejects the WHOLE offer on any
   * deviation, so a client that reshaped or dropped a member would surface as an
   * unexplained issuance failure rather than as missing artwork. That rejection
   * is an HTTP 500 — see the note on `CreateOfferRequest.offer_display`.
   */
  it("forwards offer_display and credential_response_display verbatim", async () => {
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        { transaction_id: "tx_1", credential_offer_uri: "u", dc_api_offer: {} },
        (_url, init) => {
          seenInit = init;
        },
      ),
    );

    const offerDisplay = [
      { locale: "en-US", card: { type: { code: "DEBIT" } } },
    ];
    const responseDisplay = [
      {
        locale: "en-US",
        card: {
          last_four: "2051",
          card_art: [
            { theme: "DEFAULT", image_url: "https://b.example/c.webp" },
          ],
        },
      },
    ];

    await client.createIssuanceOffer({
      credential_type_id: "com.emvco.dpc.card",
      offer_display: offerDisplay,
      credential_response_display: responseDisplay,
    });

    expect(JSON.parse(String(seenInit.body))).toEqual({
      credential_type_id: "com.emvco.dpc.card",
      offer_display: offerDisplay,
      credential_response_display: responseDisplay,
    });
  });

  it("strips a trailing slash from adminUrl so paths never double up", async () => {
    let seenUrl = "";
    const client = new FoundryClient({
      adminUrl: "http://foundry.test:9000/",
      adminKey: "k",
      fetchImpl: stubFetch(
        200,
        { transaction_id: "t", credential_offer_uri: "u" },
        (url) => {
          seenUrl = url;
        },
      ),
    });
    await client.createIssuanceOffer({ credential_type_id: "x" });
    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers");
  });

  it("throws FoundryError carrying status and body on a non-2xx response", async () => {
    const client = makeClient(stubFetch(400, { error: "bad_request" }));
    await expect(
      client.createIssuanceOffer({ credential_type_id: "nope" }),
    ).rejects.toBeInstanceOf(FoundryError);

    try {
      await client.createIssuanceOffer({ credential_type_id: "nope" });
      expect.unreachable("should have thrown");
    } catch (err) {
      const e = err as FoundryError;
      expect(e.status).toBe(400);
      expect(e.body).toContain("bad_request");
    }
  });
});

describe("FoundryClient.getIssuanceStatus", () => {
  it("GETs the transaction and returns its state", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        {
          transaction_id: "tx_1",
          credential_type_id: "com.emvco.dpc.card",
          state: "issued",
          created_at: 1,
        },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const res = await client.getIssuanceStatus("tx_1");

    expect(seenUrl).toBe("http://foundry.test:9000/admin/issuance/offers/tx_1");
    expect(seenInit.method).toBe("GET");
    expect(res.state).toBe("issued");
  });

  it("percent-encodes the transaction id", async () => {
    let seenUrl = "";
    const client = makeClient(
      stubFetch(
        200,
        {
          transaction_id: "a/b",
          credential_type_id: "c",
          state: "offered",
          created_at: 1,
        },
        (url) => {
          seenUrl = url;
        },
      ),
    );
    await client.getIssuanceStatus("a/b");
    expect(seenUrl).toBe(
      "http://foundry.test:9000/admin/issuance/offers/a%2Fb",
    );
  });
});

describe("FoundryClient verification methods", () => {
  it("creates a verification request with the request_uri transport", async () => {
    let seenBody = "";
    const client = makeClient(
      stubFetch(
        200,
        {
          verification_id: "v_1",
          openid4vp_uri: "openid4vp://?x=1",
          request_uri: "http://r",
        },
        (_url, init) => {
          seenBody = String(init.body);
        },
      ),
    );

    const res = await client.createVerificationRequest({
      transport: "request_uri",
      dcql_query: { credentials: [] },
      transaction_data: [{ type: "payment" }],
    });

    expect(JSON.parse(seenBody).transport).toBe("request_uri");
    expect(res.verification_id).toBe("v_1");
    expect(res.openid4vp_uri).toBe("openid4vp://?x=1");
  });

  // Measured 2026-08-27 against the deployed foundry: `dc_api_signed` answers
  // 200 with `protocol: "openid4vp-v1-signed"` and a `dc_api_request` of
  // `{ request: <compact JWS> }`, while `dc_api` answers
  // `protocol: "openid4vp-v1-unsigned"` and a bare parameter object. The two
  // halves are one wire contract, so the client must surface foundry's
  // identifier rather than leave the caller to derive it.
  it("forwards the dc_api_signed transport and surfaces the protocol identifier", async () => {
    let seenBody = "";
    const client = makeClient(
      stubFetch(
        200,
        {
          verification_id: "v_2",
          protocol: "openid4vp-v1-signed",
          dc_api_request: { request: "eyJ0.eyJ1.sig" },
          openid4vp_uri: null,
          request_uri: null,
        },
        (_url, init) => {
          seenBody = String(init.body);
        },
      ),
    );

    const res = await client.createVerificationRequest({
      transport: "dc_api_signed",
      named_query_ref: "payment",
    });

    expect(JSON.parse(seenBody).transport).toBe("dc_api_signed");
    expect(res.protocol).toBe("openid4vp-v1-signed");
    expect(res.dc_api_request).toEqual({ request: "eyJ0.eyJ1.sig" });
    expect(res.openid4vp_uri).toBeNull();
  });

  // `protocol` is `null` — not the empty string — for the transport that
  // performs no DC API invocation, so there is no identifier to report.
  it("surfaces a null protocol for the request_uri transport", async () => {
    const client = makeClient(
      stubFetch(200, {
        verification_id: "v_3",
        protocol: null,
        openid4vp_uri: "openid4vp://?x=1",
        request_uri: "http://r",
      }),
    );

    const res = await client.createVerificationRequest({
      transport: "request_uri",
    });

    expect(res.protocol).toBeNull();
  });

  it("returns the verification verdict with per-credential checks and claims", async () => {
    // The shape foundry actually serves (openapi.json VerificationResult,
    // confirmed 2026-08-19 against https://foundry-admin.digitallabor.dev):
    // top-level `checks` is cross-cutting only, and transaction_data_binding
    // lives on the credential it was bound to.
    const client = makeClient(
      stubFetch(200, {
        id: "v_1",
        state: "verified",
        created_at: 1,
        result: {
          verified: true,
          checks: [{ check: "jwe_decryption", passed: true }],
          credentials: [
            {
              query_id: "dpc",
              format: "dc+sd-jwt",
              claims: { credential_id: "dpc_abc", network: "girocard" },
              checks: [{ check: "transaction_data_binding", passed: true }],
            },
          ],
        },
      }),
    );

    const res = await client.getVerificationStatus("v_1");

    expect(res.state).toBe("verified");
    expect(res.result?.verified).toBe(true);
    expect(res.result?.checks[0]?.check).toBe("jwe_decryption");
    expect(res.result?.credentials[0]?.query_id).toBe("dpc");
    expect(res.result?.credentials[0]?.checks[0]?.check).toBe(
      "transaction_data_binding",
    );
  });

  it("carries every answered credential when a multi-credential query was used", async () => {
    // `dpc_av` requests two credentials, so the verdict carries two entries in
    // DCQL declaration order. Claims are per credential and never merged.
    const client = makeClient(
      stubFetch(200, {
        id: "v_2",
        state: "verified",
        created_at: 1,
        result: {
          verified: true,
          checks: [{ check: "requested_credentials_answered", passed: true }],
          credentials: [
            {
              query_id: "dpc",
              format: "dc+sd-jwt",
              claims: { credential_id: "dpc_abc" },
              checks: [{ check: "transaction_data_binding", passed: true }],
            },
            {
              query_id: "av",
              format: "mso_mdoc",
              claims: { "eu.europa.ec.av.1": { age_over_18: true } },
              checks: [{ check: "dcql_match", passed: true }],
            },
          ],
        },
      }),
    );

    const res = await client.getVerificationStatus("v_2");

    expect(res.result?.credentials.map((c) => c.query_id)).toEqual([
      "dpc",
      "av",
    ]);
    expect(res.result?.credentials[1]?.format).toBe("mso_mdoc");
  });

  it("relays a DC API response to the admin endpoint and returns the verdict", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const client = makeClient(
      stubFetch(
        200,
        {
          verified: true,
          checks: [{ check: "jwe_decryption", passed: true }],
          credentials: [
            {
              query_id: "dpc",
              format: "dc+sd-jwt",
              claims: {},
              checks: [{ check: "dcql_match", passed: true }],
            },
          ],
        },
        (url, init) => {
          seenUrl = url;
          seenInit = init;
        },
      ),
    );

    const result = await client.submitDcApiResponse(
      "v_1",
      "eyJhbGciOi.encrypted.jwe",
    );

    expect(seenUrl).toBe(
      "http://foundry.test:9000/admin/verification/requests/v_1/dc-api-response",
    );
    expect(seenInit.method).toBe("POST");
    expect(new Headers(seenInit.headers).get("authorization")).toBe(
      "Bearer k-123",
    );
    expect(JSON.parse(String(seenInit.body))).toEqual({
      response: "eyJhbGciOi.encrypted.jwe",
    });
    expect(result.verified).toBe(true);
  });

  it("percent-encodes the verification id in the dc-api-response path", async () => {
    let seenUrl = "";
    const client = makeClient(
      stubFetch(
        200,
        { verified: false, checks: [], credentials: [] },
        (url) => {
          seenUrl = url;
        },
      ),
    );
    await client.submitDcApiResponse("a/b", "jwe");
    expect(seenUrl).toBe(
      "http://foundry.test:9000/admin/verification/requests/a%2Fb/dc-api-response",
    );
  });
});
