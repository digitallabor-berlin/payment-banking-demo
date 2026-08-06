import { centsToDecimalString } from "./format.js";

/**
 * The DCQL query is fixed — this demo only ever asks for one credential type
 * and the two claims it needs to settle (spec §6.2 step 3). `credential_ids`
 * in transaction_data below must reference this query's `id: "card"`.
 */
export function buildDcqlQuery(): unknown {
  return {
    credentials: [
      {
        id: "card",
        format: "dc+sd-jwt",
        meta: { vct_values: ["com.emvco.dpc.card"] },
        claims: [{ path: ["credential_id"] }, { path: ["network"] }],
      },
    ],
  };
}

/**
 * `amount` must be a plain decimal string — confirmed against the real
 * foundry instance in Plan 1 Task 1: foundry itself performs the OpenID4VP
 * base64url-JSON encoding, so this app sends plain JSON with a string amount,
 * never a pre-encoded value and never a number (a float amount is exactly the
 * kind of silent precision bug this whole design avoids elsewhere).
 */
export function buildTransactionData(
  orderId: string,
  amountCents: number,
  merchantName: string,
): unknown[] {
  return [
    {
      type: "payment",
      credential_ids: ["card"],
      amount: centsToDecimalString(amountCents),
      currency: "EUR",
      merchant: merchantName,
      order_id: orderId,
    },
  ];
}