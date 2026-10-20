import type { AdHocMetadataRequest } from "@demo/foundry-client";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_QUERY_ID,
} from "./credential-types.js";
import type {
  LocalisedName,
  LocalisedValue,
} from "./limit-transaction-data.js";

/**
 * The request half of the phone-change binding — the sibling of
 * `limit-transaction-data.ts` and `transfer-transaction-data.ts`, and kept
 * apart from the session module for the same reason: one builds what is sent,
 * the other reads what came back, and neither should have to import the other
 * to be tested.
 */

/**
 * The `type` of the phone-change `transaction_data` entry.
 *
 * PaSO Core §5.2's `urn:paso:sca:<domain>:<suffix>:<version>` form, reusing
 * the `dev.digitallabor` domain the login, limit-change and transfer types
 * already use.
 *
 * The trailing `:1` is a version and it earns its keep: a wallet rendering
 * this payload for human confirmation needs to know which shape it has.
 */
export const PHONE_CHANGE_TRANSACTION_DATA_TYPE =
  "urn:paso:sca:dev.digitallabor:phone-change:1";

/**
 * How long the minted metadata JWT lives. 15 minutes.
 *
 * Stated explicitly rather than inherited, for the reason the limit change
 * states it: foundry's default is 300 seconds — *exactly*
 * `PHONE_CHANGE_SESSION_TTL_MS` — and the JWT is minted after the session row
 * is written, so a holder approving at T+295 would hand the wallet a JWT with
 * seconds left on it. A §5.3 `exp` failure and a holder pressing Cancel are
 * indistinguishable from the bank's side, so that race would be undiagnosable.
 *
 * Measured on the deployed foundry for the limit change: it honours 900
 * exactly.
 */
export const PHONE_CHANGE_METADATA_TTL_SECS = 900;

/**
 * The `metadata` block of the ad-hoc mint request.
 *
 * **Declared HERE rather than reusing `LimitChangeAdHocMetadata` precisely
 * because that one makes `value_type` REQUIRED on every claim** — both of its
 * claims are amounts, as are both of `TransferAdHocMetadata`'s typed ones.
 * Neither can express a claim without one, which would make this feature's
 * required ABSENCE untypeable.
 *
 * `LocalisedName` and `LocalisedValue` are imported from there: those two
 * genuinely are the same shape, and a second copy could only drift.
 *
 * **There is no `value_type` member on the claim type at all, and that is the
 * whole point.** PaSO Proof Metadata §3.1 makes `value_type` optional and
 * defines an omitted one as plain text. PaSO View §3 says a wallet SHALL
 * EXCLUDE an entry whose declared `value_type` it does not support — the
 * ENTRY, not the label. There is no registered value type for a telephone
 * number, so a plausible-looking `"phone_number"` or `"e164"` is a hard
 * refusal of the whole presentation: the holder reads "Transaction can't be
 * displayed" and the change cannot be approved at all. Inventing one is the
 * single most likely way to break this feature.
 */
export interface PhoneChangeAdHocMetadata {
  claims: Array<{
    path: string[];
    mandatory: boolean;
    display: LocalisedName[];
  }>;
  ui_labels: Record<string, LocalisedValue[]>;
}

/**
 * The PaSO §5 ad-hoc transaction data metadata to mint for a phone change.
 *
 * Takes no arguments: nothing in it varies per request. The two numbers live
 * in the `transaction_data` entry's payload, not in its metadata — the
 * metadata says how to RENDER two claims, not what they are.
 *
 * **The metadata override is what makes this work at all, with no foundry
 * configuration change.** PaSO §5.4 says a type covered by a valid ad-hoc JWT
 * is "considered supported … even if it is absent from the signed credential
 * metadata". `sparkassen_auth` is the only configuration on the deployed
 * foundry carrying a `credential_metadata_uri`, and that document declares
 * only the login type — so phone-change is a type absent from a credential
 * metadata document that exists, the literal §5.4 case.
 *
 * Claim ORDER IS CONSENT ORDER: old then new, so the screen reads as a
 * transition rather than as two unrelated facts.
 *
 * **THE LOCALE TAGS ARE BARE `en` AND `de`, AND MUST STAY THE SHORTEST TAG
 * THAT NAMES THE LANGUAGE.** The limit change shipped `en-US` / `de-DE` and it
 * broke every real presentation with "Transaction can't be displayed"
 * (reported 2026-10-19). RFC4647 §3.4 Lookup only ever SHORTENS the user's
 * range, so a region tag is strictly *less* reachable: `en-US` is matched only
 * by a range of `en-US`, while `en` is matched by `en`, `en-US`, `en-GB`,
 * `en-IE` and every other variant. PaSO View §4 is all-or-nothing, so failing
 * to select a locale refuses the ENTIRE presentation rather than degrading one
 * label.
 *
 * Both locales are ALWAYS sent regardless of the bank's current UI locale: the
 * wallet picks by its own priority list, which the bank cannot observe.
 */
export function buildPhoneChangeAdHocMetadataRequest(): AdHocMetadataRequest {
  const metadata: PhoneChangeAdHocMetadata = {
    claims: [
      {
        path: ["old_phone"],
        mandatory: true,
        display: [
          { locale: "en", name: "Current mobile number" },
          { locale: "de", name: "Aktuelle Mobilnummer" },
        ],
      },
      {
        path: ["new_phone"],
        mandatory: true,
        display: [
          { locale: "en", name: "New mobile number" },
          { locale: "de", name: "Neue Mobilnummer" },
        ],
      },
    ],
    ui_labels: {
      transaction_title: [
        { locale: "en", value: "Confirm your new mobile number" },
        { locale: "de", value: "Neue Mobilnummer bestätigen" },
      ],
      affirmative_action_label: [
        { locale: "en", value: "Confirm number" },
        { locale: "de", value: "Nummer bestätigen" },
      ],
      denial_action_label: [
        { locale: "en", value: "Cancel" },
        { locale: "de", value: "Abbrechen" },
      ],
      /**
       * The one label that says something the two numbers do not.
       *
       * Redirecting a victim's mobile number is a standard step in account
       * takeover and in SIM-swap fraud, where the fraudster talks the victim
       * through the bank's own UI. PaSO §3.2 requires the wallet to display
       * this verbatim and forbids altering or removing it — so the bank's
       * warning cannot be dressed up by whatever is driving the browser.
       */
      security_hint: [
        {
          locale: "en",
          value: "Sparkasse will never ask you to change your mobile number.",
        },
        {
          locale: "de",
          value:
            "Die Sparkasse wird Sie niemals bitten, Ihre Mobilnummer zu ändern.",
        },
      ],
    },
  };

  return {
    credential_type_id: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
    // Must equal the entry's own `type` — foundry binds the two, and a
    // mismatch makes the override cover a type nothing sends.
    transaction_data_type: PHONE_CHANGE_TRANSACTION_DATA_TYPE,
    metadata,
    ttl_secs: PHONE_CHANGE_METADATA_TTL_SECS,
  };
}

/**
 * The single `transaction_data` entry sent with every phone change.
 *
 * Plain JSON: foundry performs the OpenID4VP §8.4 base64url encoding itself,
 * so a pre-encoded value here would be double-encoded. That applies to
 * `metadata` too — the minted JWT rides verbatim, never re-wrapped.
 *
 * `credential_ids` is `SPARKASSEN_AUTH_QUERY_ID`, the **DCQL query id**, not
 * the credential type constant. The two deliberately share a spelling and are
 * deliberately separate constants: foundry validates this list against the
 * resolved named query's credential ids and 400s on an unknown one, and
 * nothing forces the two registries to agree.
 *
 * **The two numbers ride VERBATIM — no derivation of any kind.** They are
 * hashed byte-for-byte into `transaction_data_hashes`, so anything applied
 * between `users.phone_number` and this payload would become part of the
 * signed artefact and make what the holder approved differ from what the bank
 * stored. The caller normalises once, on the way in; nothing happens here.
 *
 * **`metadataJwt` is required, not optional.** If the mint failed the caller
 * must abort rather than send an entry without it: a `transaction_data` type
 * no credential's metadata declares, carrying no override, is PaSO Core
 * §7.4.2 "incompatible" — best case the wallet refuses, worst case it renders
 * `old_phone: +49 171 5555555` as a raw key-value pair, which looks like the
 * feature working.
 */
export function buildPhoneChangeTransactionData(input: {
  oldPhone: string;
  newPhone: string;
  metadataJwt: string;
}): unknown[] {
  return [
    {
      type: PHONE_CHANGE_TRANSACTION_DATA_TYPE,
      credential_ids: [SPARKASSEN_AUTH_QUERY_ID],
      transaction_data_hashes_alg: ["sha-256"],
      payload: {
        old_phone: input.oldPhone,
        new_phone: input.newPhone,
      },
      metadata: input.metadataJwt,
    },
  ];
}