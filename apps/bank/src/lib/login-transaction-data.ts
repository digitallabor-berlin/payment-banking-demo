import { SPARKASSEN_AUTH_QUERY_ID } from "./credential-types.js";

/**
 * The request half of the login binding — a sibling of the merchant's
 * `dcql.ts`, kept apart from `login-checks.ts` for the same reason the merchant
 * keeps those two apart: one builds what is sent, the other reads what came
 * back, and neither should have to import the other to be tested.
 */

/**
 * The `type` of the login `transaction_data` entry.
 *
 * `transaction_data` is not a payment mechanism — it binds whatever the holder
 * is approving into the KB-JWT, and OpenID4VP leaves the `type` open precisely
 * so a non-payment approval can name itself. This one says "a login", and the
 * trailing `:1` is a version: a wallet that renders the payload for human
 * confirmation needs to know which shape it is looking at.
 */
export const LOGIN_TRANSACTION_DATA_TYPE =
  "urn:paso:sca:dev.digitallabor:login:1";

/**
 * The instant, as seconds-precision UTC with an explicit zone marker:
 * `2026-08-25T16:45:00Z`.
 *
 * Two deliberate departures from `toISOString()`:
 *
 * Milliseconds are TRUNCATED, not rounded — `.999` is still `:00`. The string
 * is hashed into `transaction_data_hashes` and compared byte-for-byte, so
 * sub-second noise buys nothing and shows up in whatever a wallet renders to
 * the holder. Truncation keeps the second stable rather than letting it tick
 * forward under a rounding rule nobody reading the payload would guess.
 *
 * The `Z` is kept rather than dropped to match a bare
 * `2026-08-25T16:45:00`. Without it the string looks local while being UTC,
 * which is exactly how a wallet ends up showing a login an hour off.
 *
 * Takes the instant rather than reading the clock, so the value is a pure
 * function of `startLoginSession`'s existing `now` parameter.
 */
export function loginDatetime(now: number): string {
  return `${new Date(now).toISOString().slice(0, 19)}Z`;
}

/**
 * The single `transaction_data` entry sent with every wallet login.
 *
 * Sent as plain JSON: foundry performs the OpenID4VP §8.4 base64url encoding
 * itself, so a pre-encoded value here would be double-encoded.
 *
 * `credential_ids` names the authenticator query and nothing else. foundry
 * validates these against the resolved query's credential ids and rejects an
 * unknown one outright, and `sparkassen_auth` is the only credential the
 * `sparkassen_auth` named query declares. Naming a payment credential would be
 * wrong twice over: foundry would 400, and a login is not an instrument.
 *
 * `transaction_data_hashes_alg` is sent explicitly even though foundry inserts
 * its own configured value when the key is absent (`or_insert_with`, so ours
 * wins rather than conflicts). Stating it keeps the entry self-describing where
 * it is constructed instead of correct only by remote default.
 */
export function buildLoginTransactionData(now: number): unknown[] {
  return [
    {
      type: LOGIN_TRANSACTION_DATA_TYPE,
      credential_ids: [SPARKASSEN_AUTH_QUERY_ID],
      transaction_data_hashes_alg: ["sha-256"],
      payload: { login_datetime: loginDatetime(now) },
    },
  ];
}
