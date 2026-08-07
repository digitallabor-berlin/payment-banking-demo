import type {
  AdminIssuanceStatus,
  CreateOfferRequest,
  CreateOfferResponse,
  CreateVerificationRequest,
  CreateVerificationResponse,
  VerificationResult,
  VerificationTransaction,
} from "./types.js";

/** A non-2xx response from foundry's admin API. */
export class FoundryError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`foundry admin request failed with HTTP ${status}`);
    this.name = "FoundryError";
    this.status = status;
    this.body = body;
  }
}

export interface FoundryClientOptions {
  /** Base URL of foundry's ADMIN listener, e.g. http://127.0.0.1:9000 */
  adminUrl: string;
  adminKey: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class FoundryClient {
  private readonly adminUrl: string;
  private readonly adminKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FoundryClientOptions) {
    this.adminUrl = opts.adminUrl.replace(/\/+$/, "");
    this.adminKey = opts.adminKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async createIssuanceOffer(req: CreateOfferRequest): Promise<CreateOfferResponse> {
    return this.request<CreateOfferResponse>("POST", "/admin/issuance/offers", req);
  }

  async getIssuanceStatus(transactionId: string): Promise<AdminIssuanceStatus> {
    const path = `/admin/issuance/offers/${encodeURIComponent(transactionId)}`;
    return this.request<AdminIssuanceStatus>("GET", path);
  }

  async createVerificationRequest(
    req: CreateVerificationRequest,
  ): Promise<CreateVerificationResponse> {
    return this.request<CreateVerificationResponse>(
      "POST",
      "/admin/verification/requests",
      req,
    );
  }

  async getVerificationStatus(verificationId: string): Promise<VerificationTransaction> {
    const path = `/admin/verification/requests/${encodeURIComponent(verificationId)}`;
    return this.request<VerificationTransaction>("GET", path);
  }

  /**
   * Relays a browser Digital Credentials API response to foundry. This is an
   * ADMIN endpoint, so it can only ever be called server-side — the admin key
   * must never reach a browser. foundry verifies synchronously and returns the
   * verdict, but callers may discard it: the transaction state it also writes
   * is what the existing poll reads.
   */
  async submitDcApiResponse(
    verificationId: string,
    response: string,
  ): Promise<VerificationResult> {
    const path = `/admin/verification/requests/${encodeURIComponent(verificationId)}/dc-api-response`;
    return this.request<VerificationResult>("POST", path, { response });
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.adminKey}`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

    const res = await this.fetchImpl(`${this.adminUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) throw new FoundryError(res.status, text);
    return JSON.parse(text) as T;
  }
}