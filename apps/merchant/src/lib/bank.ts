import { env } from "../env.js";

export interface BankPayInput {
  credentialId: string;
  amountCents: number;
  currency: string;
  merchant: string;
  reference: string;
  idempotencyKey: string;
}

export type BankPayResult =
  | { ok: true; bankTxId: string }
  | { ok: false; reason: "insufficient_funds" | "credential_invalid" | "bank_unreachable" };

export interface BankClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Injectable for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class BankClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: BankClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async pay(input: BankPayInput): Promise<BankPayResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({
          credential_id: input.credentialId,
          amount_cents: input.amountCents,
          currency: input.currency,
          merchant: input.merchant,
          reference: input.reference,
          idempotency_key: input.idempotencyKey,
        }),
        cache: "no-store",
      });
    } catch {
      // Network-level failure: the bank was never reached, so nothing was
      // debited. Spec §6.3's honest hard case.
      return { ok: false, reason: "bank_unreachable" };
    }

    if (response.ok) {
      const body = (await response.json()) as { bank_tx_id?: unknown };
      if (typeof body.bank_tx_id !== "string") return { ok: false, reason: "bank_unreachable" };
      return { ok: true, bankTxId: body.bank_tx_id };
    }

    if (response.status === 402) return { ok: false, reason: "insufficient_funds" };
    if (response.status === 404) return { ok: false, reason: "credential_invalid" };
    // 401 (bad shared secret) and 5xx are both operator problems, not user
    // problems — surfaced the same way, since the user can only retry.
    return { ok: false, reason: "bank_unreachable" };
  }
}

let instance: BankClient | null = null;

export function getBankClient(): BankClient {
  instance ??= new BankClient({ baseUrl: env.BANK_API_URL, apiKey: env.BANK_API_KEY });
  return instance;
}