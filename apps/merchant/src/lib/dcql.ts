import type { NamedQueryRef } from "../db/schema.js";
import { centsToDecimalString } from "./format.js";

/**
 * Products a customer must prove they are old enough to buy. Ids, not names or
 * categories: the whole `Drinks` aisle is not restricted (mineral water lives
 * there), and a name is a display string a merchandiser may reword.
 *
 * Deliberately a hardcoded set rather than a `products` column. This is a demo
 * of a payment credential, not of a compliance engine, and a column would imply
 * an editing surface that does not exist. Promote it to the schema the moment
 * anything other than this list needs to change it.
 */
export const AGE_RESTRICTED_PRODUCT_IDS = ["beer", "wine", "aperitif"] as const;

const RESTRICTED = new Set<string>(AGE_RESTRICTED_PRODUCT_IDS);

/**
 * Whether buying this product requires proving an age. The storefront renders a
 * tag from this and `selectNamedQuery` escalates from it, so the shelf can never
 * promise a check the presentation does not ask for.
 */
export function isAgeRestricted(productId: string): boolean {
 return RESTRICTED.has(productId);
}

/**
 * Picks which foundry named query to present with (see the `named_queries`
 * block in foundry's config): `payment` for an ordinary basket, `payment_av`
 * when anything in it is age-restricted.
 *
 * Both declare TWO payment credentials — the EMV DPC (`dpc`) and the Sparkassen
 * Card (`sparkassencard`) — conjoined by a `credential_sets` entry that requires
 * exactly one of them, so a holder of either can pay. `payment_av` adds a
 * second required set of two age formats, `av_sdjwt` (an SD-JWT VC) and
 * `av_mdoc` (an ISO mdoc EU Proof of Age, `eu.europa.ec.av.1`), whose only
 * requested element is `age_over_18` either way. So the escalation asks for one
 * extra boolean and never for a birthdate: §6 data minimisation, decided at
 * foundry.
 *
 * Takes product ids rather than an order id so the decision is pure and
 * testable; the caller reads them from `order_items`, never from the browser.
 */
export function selectNamedQuery(productIds: readonly string[]): NamedQueryRef {
 return productIds.some(isAgeRestricted) ? "payment_av" : "payment";
}

export interface PaymentTransactionData {
 /** Uniquely identifies this authorization attempt — the payment session id. */
 transactionId: string;
 amountCents: number;
 payeeName: string;
 payeeId: string;
}

/**
 * The single `transaction_data` entry sent with every payment presentation.
 *
 * Sent as plain JSON: foundry performs the OpenID4VP §8.4 base64url encoding
 * itself, so a pre-encoded value here would be double-encoded.
 *
 * `credential_ids` names every payment credential and no age credential.
 * foundry validates these against the resolved query's credential ids and
 * rejects an unknown one; `payment` and `payment_av` both declare `dpc`,
 * `sparkassencard` and `wero` as the three options of one required
 * `credential_sets` entry, and the holder chooses which to answer with, so
 * naming a subset leaves the amount unbound whenever the wallet answers with
 * one of the others. That is a hard decline rather than a soft gap:
 * `transaction_data` binds only to the credentials it names, so an unnamed one's
 * KB-JWT carries no `transaction_data_hashes`, foundry cannot report
 * `transaction_data_binding` as passed on it, and the payment fails the gate.
 * Binding to the *payment* credential is the point — an age attestation is not
 * what authorizes money to move.
 *
 * This list and `PAYMENT_JOIN_KEY_CLAIM` in `checks.ts` are widened together:
 * the first decides whether the amount can be confirmed, the second whether the
 * merchant can tell the bank who to debit. Widening only the second would turn
 * a decline into a settlement against an *unbound* amount.
 *
 * `transaction_data_hashes_alg` is sent explicitly even though foundry inserts
 * its own configured value when the key is absent (it uses `or_insert_with`, so
 * ours wins rather than conflicts). Stating it keeps the entry self-describing
 * at the point it is constructed, instead of correct only by remote default.
 *
 * `amount_display` is built with `toFixed`, never `Intl`. It is hashed into
 * `transaction_data_hashes` and compared byte-for-byte, so a thousands
 * separator or a comma decimal mark — both of which `Intl` produces under other
 * locales — would break the binding check on a differently-configured host.
 */
export function buildTransactionData(
 payment: PaymentTransactionData,
): unknown[] {
 return [
  {
   type: "urn:eudi:sca:payment:1",
   credential_ids: ["dpc", "sparkassencard", "wero"],
   transaction_data_hashes_alg: ["sha-256"],
   payload: {
    payee: { name: payment.payeeName, id: payment.payeeId },
    transaction_id: payment.transactionId,
    amount_display: `€ ${centsToDecimalString(payment.amountCents)}`,
   },
  },
 ];
}
