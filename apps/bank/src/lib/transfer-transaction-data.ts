import type { AdHocMetadataRequest } from "@demo/foundry-client";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_QUERY_ID,
} from "./credential-types.js";
import { formatIban } from "./format.js";
import { isoCurrencyAmountString } from "./iso-currency-amount.js";
import type {
  LocalisedName,
  LocalisedValue,
} from "./limit-transaction-data.js";

/**
 * The request half of the transfer binding — the sibling of
 * `limit-transaction-data.ts` and `login-transaction-data.ts`, and kept apart
 * from the session module for the same reason: one builds what is sent, the
 * other reads what came back, and neither should have to import the other to
 * be tested.
 */

/**
 * The `type` of the transfer `transaction_data` entry.
 *
 * PaSO Core §5.2's `urn:paso:sca:<domain>:<suffix>:<version>` form, reusing the
 * `dev.digitallabor` domain the login and limit-change types already use.
 *
 * The trailing `:1` is a version and it matters: a wallet rendering this
 * payload for human confirmation needs to know which shape it is looking at,
 * and this one has four claims including a recipient a reader is being asked
 * to check against what they typed.
 */
export const TRANSFER_TRANSACTION_DATA_TYPE =
  "urn:paso:sca:dev.digitallabor:transfer:1";

/**
 * How long the minted metadata JWT lives. 15 minutes.
 *
 * Stated explicitly rather than inherited, for the reason
 * `LIMIT_CHANGE_METADATA_TTL_SECS` documents in full: foundry's default is 300
 * seconds — *exactly* `TRANSFER_SESSION_TTL_MS` — and the JWT is minted after
 * the session row is written, so a holder approving near the end of a session
 * would be handed a JWT with seconds left. A §5.3 `exp` failure and a holder
 * pressing Cancel are indistinguishable from the bank's side.
 *
 * Measured for the limit change: the deployed foundry honours 900 exactly.
 */
export const TRANSFER_METADATA_TTL_SECS = 900;

/**
 * The `metadata` block of the transfer's ad-hoc mint request.
 *
 * Declared here rather than reusing `LimitChangeAdHocMetadata`, and the
 * difference is the whole point: that interface makes `value_type` REQUIRED on
 * every claim, because both of its claims are amounts. Only one of these four
 * is. PaSO Proof Metadata §3.1 makes `value_type` optional and PaSO View §3
 * says a wallet SHALL EXCLUDE an entry whose declared `value_type` it does not
 * support — so the three non-amount claims must carry none at all, and a type
 * that cannot express that absence would make the mistake untypeable rather
 * than impossible.
 *
 * `LocalisedName` and `LocalisedValue` ARE imported from there: those two
 * genuinely are the same shape, and a second copy could only drift.
 */
export interface TransferAdHocMetadata {
  claims: Array<{
    path: string[];
    mandatory: boolean;
    /** Present on `amount` and on nothing else. See above. */
    value_type?: string;
    display: LocalisedName[];
  }>;
  ui_labels: Record<string, LocalisedValue[]>;
}

/**
 * The PaSO §5 ad-hoc transaction data metadata to mint for a transfer.
 *
 * Takes no arguments: nothing in it varies per request. The four values live
 * in the `transaction_data` entry's payload, not in its metadata — the
 * metadata says how to RENDER four claims, not what they are.
 *
 * **The metadata override is what makes this work at all.** PaSO §5.4 says a
 * type covered by a valid ad-hoc JWT is "considered supported … even if it is
 * absent from the signed credential metadata", and foundry implements exactly
 * that: with an override present it never consults the credential type's
 * configured `transaction_data_types`. So this new type needs NO foundry
 * config change, exactly as the limit change needed none.
 *
 * **CLAIM ORDER IS CONSENT ORDER: amount, recipient, IBAN, purpose.** Amount
 * first because it is the number a defrauded person needs to notice. The
 * dialog's field order is ENTRY order — recipient, IBAN, amount, purpose — and
 * the two are allowed to differ because they serve different jobs.
 *
 * **THE TAGS ARE BARE `en` AND `de`.** `en-US`/`de-DE` broke every real
 * limit-change presentation with "Transaction can't be displayed" (reported
 * 2026-10-19): RFC 4647 Lookup only ever SHORTENS a user's range, so a region
 * tag is strictly *less* reachable, and because PaSO View §4 is all-or-nothing
 * a locale that resolves nothing refuses the ENTIRE presentation rather than
 * degrading one label. Both locales are always sent regardless of the bank's
 * current UI locale: the wallet picks by its own priority list, which the bank
 * cannot observe.
 */
export function buildTransferAdHocMetadataRequest(): AdHocMetadataRequest {
  const metadata: TransferAdHocMetadata = {
    claims: [
      {
        path: ["amount"],
        mandatory: true,
        value_type: "iso_currency_amount",
        display: [
          { locale: "en", name: "Amount" },
          { locale: "de", name: "Betrag" },
        ],
      },
      {
        // No `value_type`. A recipient name is plain text, and PaSO Proof
        // Metadata §3.1 says an omitted `value_type` means exactly that.
        path: ["payee_name"],
        mandatory: true,
        display: [
          { locale: "en", name: "Recipient" },
          { locale: "de", name: "Empfänger" },
        ],
      },
      {
        // No `value_type`, and do NOT invent one. There is no registered type
        // for an IBAN, and declaring an unsupported one excludes the entry —
        // which refuses the whole presentation, not just this row.
        path: ["payee_iban"],
        mandatory: true,
        display: [
          { locale: "en", name: "Recipient IBAN" },
          { locale: "de", name: "Empfänger-IBAN" },
        ],
      },
      {
        path: ["purpose"],
        mandatory: true,
        display: [
          { locale: "en", name: "Purpose" },
          { locale: "de", name: "Verwendungszweck" },
        ],
      },
    ],
    ui_labels: {
      transaction_title: [
        { locale: "en", value: "Approve this transfer" },
        { locale: "de", value: "Überweisung freigeben" },
      ],
      affirmative_action_label: [
        { locale: "en", value: "Confirm transfer" },
        { locale: "de", value: "Überweisung bestätigen" },
      ],
      denial_action_label: [
        { locale: "en", value: "Cancel" },
        { locale: "de", value: "Abbrechen" },
      ],
      /**
       * The one label that says something the four values do not, and it
       * matters more here than it did for the limit change.
       *
       * Authorised push payment fraud IS this screen: a fraudster talks a
       * victim through their own bank's UI to a transfer the victim authorises
       * themselves. PaSO §3.2 requires the wallet to display this string
       * exactly as provided and forbids altering or removing it — so the
       * bank's warning cannot be dressed up by whatever is driving the
       * browser.
       */
      security_hint: [
        {
          locale: "en",
          value:
            "Sparkasse will never ask you to transfer money to a new account.",
        },
        {
          locale: "de",
          value:
            "Die Sparkasse wird Sie niemals bitten, Geld auf ein neues Konto zu überweisen.",
        },
      ],
    },
  };

  return {
    credential_type_id: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
    // Must equal the entry's own `type` — foundry binds the two, and a
    // mismatch makes the override cover a type nothing sends.
    transaction_data_type: TRANSFER_TRANSACTION_DATA_TYPE,
    metadata,
    ttl_secs: TRANSFER_METADATA_TTL_SECS,
  };
}

/**
 * The single `transaction_data` entry sent with every transfer.
 *
 * Plain JSON: foundry performs the OpenID4VP §8.4 base64url encoding itself, so
 * a pre-encoded value here would be double-encoded. That applies to `metadata`
 * too — the minted JWT rides verbatim, never re-wrapped.
 *
 * `credential_ids` is `SPARKASSEN_AUTH_QUERY_ID`, the **DCQL query id**, not
 * the credential type constant. The two deliberately share a spelling and are
 * deliberately separate constants: foundry validates this list against the
 * resolved named query's credential ids and 400s on an unknown one.
 *
 * **`payeeIban` arrives NORMALISED and is rendered through `formatIban`.** The
 * payload is what the holder READS, and the entire point of the consent screen
 * is that they can compare it against what they typed. `formatIban` strips and
 * regroups deterministically, so the hash is stable and there is still one
 * stored source for the IBAN.
 *
 * **`metadataJwt` is required, not optional.** If the mint failed the caller
 * must abort rather than send an entry without it: a `transaction_data` type
 * that no credential's metadata declares, carrying no override, is PaSO Core
 * §7.4.2 "incompatible" — best case the wallet refuses, worst case it renders
 * raw claim names and an unformatted amount to a human, which looks like the
 * feature working.
 */
export function buildTransferTransactionData(input: {
  payeeName: string;
  payeeIban: string;
  amountCents: number;
  purpose: string;
  metadataJwt: string;
}): unknown[] {
  return [
    {
      type: TRANSFER_TRANSACTION_DATA_TYPE,
      credential_ids: [SPARKASSEN_AUTH_QUERY_ID],
      transaction_data_hashes_alg: ["sha-256"],
      payload: {
        amount: isoCurrencyAmountString(input.amountCents),
        payee_name: input.payeeName,
        payee_iban: formatIban(input.payeeIban),
        purpose: input.purpose,
      },
      metadata: input.metadataJwt,
    },
  ];
}