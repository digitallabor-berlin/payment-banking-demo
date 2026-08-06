import { timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export class InvalidApiKeyError extends Error {
  constructor() {
    super("Invalid or missing API key");
    this.name = "InvalidApiKeyError";
  }
}

/**
 * Throws InvalidApiKeyError unless the `X-API-Key` header exactly matches
 * `env.BANK_API_KEY`. The length check happens before `timingSafeEqual` is
 * called — that function throws a RangeError on mismatched buffer lengths
 * rather than returning false, so the length check is load-bearing, not just
 * an optimisation.
 */
export function requireApiKey(request: Request): void {
  const provided = request.headers.get("x-api-key");
  if (!provided) throw new InvalidApiKeyError();

  const expected = Buffer.from(env.BANK_API_KEY);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new InvalidApiKeyError();
  }
}