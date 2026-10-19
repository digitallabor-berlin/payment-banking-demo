import type { AdHocMetadataRequest } from "@demo/foundry-client";
import {
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_QUERY_ID,
} from "./credential-types.js";

/**
 * The request half of the limit-change binding — the sibling of
 * `login-transaction-data.ts`, and kept apart from the session module for the
 * same reason: one builds what is sent, the other reads what came back, and
 * neither should have to import the other to be tested.
 */

/**
 * The `type` of the limit-change `transaction_data` entry.
 *
 * PaSO Core §5.2's `urn:paso:sca:<domain>:<suffix>:<version>` form, reusing the
 * `dev.digitallabor` domain the login type already uses. foundry validates the
 * shape at mint time; hyphens in the suffix are permitted (the validator
 * constrains only emptiness and the version segment).
 *
 * The trailing `:1` is a version, and it matters more here than for a login: a
 * wallet rendering this payload for human confirmation needs to know which
 * shape it is looking at, and this one has two amounts in it.
 */
export const LIMIT_CHANGE_TRANSACTION_DATA_TYPE =
  "urn:paso:sca:dev.digitallabor:limit-change:1";

/**
 * How long the minted metadata JWT lives. 15 minutes.
 *
 * Stated explicitly rather than inherited. foundry's default is 300 seconds —
 * *exactly* `LIMIT_CHANGE_SESSION_TTL_MS`, and the JWT is minted after the
 * session row is written, so a holder approving at T+295 would hand the wallet
 * a metadata JWT with seconds left on it. A §5.3 `exp` failure and a holder
 * pressing Cancel are indistinguishable from the bank's side, so that race
 * would be undiagnosable.
 *
 * 900 is comfortably longer than any session that can still be alive, and
 * nothing caches the JWT, so a long TTL costs nothing. It also makes the
 * deployed `issuer.paso_metadata.adhoc_ttl_secs` irrelevant, which matters
 * because that value is not readable from here and could itself be below 300.
 *
 * Measured: the deployed foundry honours 900 exactly — `exp - iat` is 900 and
 * the echoed `exp` agrees with the signed one.
 */
export const LIMIT_CHANGE_METADATA_TTL_SECS = 900;

/** One `{ locale, name }` pair of a claim's display array. */
export interface LocalisedName {
  locale: string;
  name: string;
}

/** One `{ locale, value }` pair of a `ui_labels` entry. */
export interface LocalisedValue {
  locale: string;
  value: string;
}

/**
 * The `metadata` block of the ad-hoc mint request.
 *
 * Declared HERE and not in `@demo/foundry-client`, where `metadata` is
 * deliberately `unknown`: foundry validates this shape and that package must
 * not keep a second, drifting copy of its contract. The bank owns the shape it
 * sends, and this type is what its tests narrow through.
 */
export interface LimitChangeAdHocMetadata {
  claims: Array<{
    path: string[];
    mandatory: boolean;
    value_type: string;
    display: LocalisedName[];
  }>;
  ui_labels: Record<string, LocalisedValue[]>;
}

/**
 * Integer cents to the `"EUR 1000.00"` form PaSO's own examples use (§A.4
 * carries `"EUR 45.00"`): ISO currency code, one space, plain decimal, two
 * places.
 *
 * `toFixed`, NEVER `Intl`. The string is hashed byte-for-byte into
 * `transaction_data_hashes`, so a German thousands separator baked in here
 * would make the signed artefact depend on the browser's locale — the same
 * rule the merchant's `transaction_data.amount` already follows, and the
 * opposite of what `formatEuroCents` is for.
 *
 * Locale-neutrality is not a loss of presentation: the wallet localises it,
 * via the `iso_currency_amount` value type declared on both claims.
 *
 * This is the ONLY place integer cents become a decimal string in this flow.
 */
export function limitAmountString(cents: number): string {
  return `EUR ${(cents / 100).toFixed(2)}`;
}

/**
 * The PaSO §5 ad-hoc transaction data metadata to mint for a limit change.
 *
 * Takes no arguments: nothing in it varies per request. The amounts live in the
 * `transaction_data` entry's payload, not in its metadata — the metadata says
 * how to RENDER two claims, not what they are. It is nevertheless minted fresh
 * per request rather than cached, because a cache is a second thing that can be
 * stale in a demo and the saving is one HTTP call on a flow a human drives by
 * hand.
 *
 * **The metadata override is what makes this work at all.** PaSO §5.4 says a
 * type covered by a valid ad-hoc JWT is "considered supported … even if it is
 * absent from the signed credential metadata", and foundry implements exactly
 * that: with an override present it never consults the credential type's
 * configured `transaction_data_types`. So no foundry config change is needed.
 * `sparkassen_auth` genuinely is a PaSO Credential on the deployed foundry —
 * it is the only configuration carrying a `credential_metadata_uri`, and that
 * document declares a `transaction_data_types` map holding only the login type
 * — which makes limit-change a type absent from a credential metadata document
 * that exists, the literal case §5.4 is written about.
 *
 * Both locales are ALWAYS sent, regardless of the bank's current UI locale: the
 * wallet picks by its own locale priority list, which the bank cannot observe,
 * and §5.4 lets a wallet treat an entry with no compatible locale as
 * incompatible. That makes it correctness, not polish.
 *
 * **THE TAGS ARE BARE `en` AND `de`, AND THEY MUST STAY THE SHORTEST TAG THAT
 * NAMES THE LANGUAGE.** This was `en-US` / `de-DE` and it broke every real
 * presentation with "Transaction can't be displayed" (reported 2026-10-19).
 *
 * The reasoning that produced the region tags was: every tag the deployed
 * foundry publishes is region-tagged, and "a wallet doing RFC4647 lookup
 * degrades `de-DE` to `de` but is not obliged to promote `de` to `de-DE`".
 * The second half is a correct description of Lookup and the exact opposite of
 * the conclusion to draw from it. RFC4647 §3.4 only ever SHORTENS the user's
 * range, so a region tag is strictly *less* reachable than a bare one:
 * `en-US` can be matched only by a user whose range is `en-US`, while `en` is
 * matched by `en`, `en-US`, `en-GB`, `en-IE` and every other variant.
 *
 * Measured against El Paso's own `LocaleSelector`: with `en-US`/`de-DE` only,
 * phones set to `en-GB`, `de-AT`, `de-CH`, bare `en` or `fr-FR` all failed to
 * select any locale — and because PaSO View §4 is all-or-nothing, failing one
 * array refuses the ENTIRE presentation rather than degrading one label. That
 * wallet's last-resort fallback is bare `en`, which also missed.
 *
 * A locale-less default entry would be the other half of the belt-and-braces
 * (PaSO View §4 defines the entry with no `locale` as the default), and is
 * deliberately NOT added here: with bare tags present, every wallet whose
 * fallback is English already resolves, and a second English string in each
 * array is a second thing to keep in step. Add it if a wallet is found whose
 * fallback is neither `en` nor the device language.
 *
 * Verified against the deployed foundry: bare tags mint at HTTP 200 and are
 * echoed back unchanged.
 */
export function buildLimitChangeAdHocMetadataRequest(): AdHocMetadataRequest {
  const metadata: LimitChangeAdHocMetadata = {
    claims: [
      {
        path: ["old_limit"],
        mandatory: true,
        value_type: "iso_currency_amount",
        display: [
          { locale: "en", name: "Current Account Limit" },
          { locale: "de", name: "Aktuelles Kontolimit" },
        ],
      },
      {
        path: ["new_limit"],
        mandatory: true,
        value_type: "iso_currency_amount",
        display: [
          { locale: "en", name: "New Account Limit" },
          { locale: "de", name: "Neues Kontolimit" },
        ],
      },
    ],
    ui_labels: {
      transaction_title: [
        { locale: "en", value: "Change your account limit" },
        { locale: "de", value: "Kontolimit ändern" },
      ],
      affirmative_action_label: [
        { locale: "en", value: "Confirm Limit Change" },
        { locale: "de", value: "Limitänderung bestätigen" },
      ],
      /**
       * Accepted and echoed by the deployed foundry — measured, not inferred.
       * So the "Cancel" half of the consent screen is under the bank's control
       * at mint time. Whether a *wallet* honours it is a separate question and
       * is not measured.
       */
      denial_action_label: [
        { locale: "en", value: "Cancel" },
        { locale: "de", value: "Abbrechen" },
      ],
      /**
       * Present deliberately, and this is the one label that says something
       * the two amounts do not. Raising a transfer limit is a standard step in
       * an authorised push payment scam, where the fraudster talks the victim
       * through the bank's own UI. PaSO §3.2 requires the wallet to display
       * this verbatim and forbids altering or removing it — which is exactly
       * the property wanted: the bank's warning cannot be dressed up by
       * whatever is driving the browser.
       */
      security_hint: [
        {
          locale: "en",
          value: "Sparkasse will never ask you to raise your limit.",
        },
        {
          locale: "de",
          value: "Die Sparkasse wird Sie niemals bitten, Ihr Limit zu erhöhen.",
        },
      ],
    },
  };

  return {
    credential_type_id: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
    // Must equal the entry's own `type` — foundry binds the two, and a
    // mismatch makes the override cover a type nothing sends.
    transaction_data_type: LIMIT_CHANGE_TRANSACTION_DATA_TYPE,
    metadata,
    ttl_secs: LIMIT_CHANGE_METADATA_TTL_SECS,
  };
}

/**
 * The single `transaction_data` entry sent with every limit change.
 *
 * Plain JSON: foundry performs the OpenID4VP §8.4 base64url encoding itself, so
 * a pre-encoded value here would be double-encoded. That applies to `metadata`
 * too — the minted JWT rides verbatim, never re-wrapped.
 *
 * `credential_ids` is `SPARKASSEN_AUTH_QUERY_ID`, the **DCQL query id**, not
 * the credential type constant. The two deliberately share a spelling and are
 * deliberately separate constants: foundry validates this list against the
 * resolved named query's credential ids and 400s on an unknown one, and
 * nothing forces the two registries to agree.
 *
 * `transaction_data_hashes_alg` is stated explicitly even though foundry would
 * insert its configured value when the key is absent (`or_insert_with`, so ours
 * wins rather than conflicts). The entry should be self-describing where it is
 * constructed rather than correct only by remote default.
 *
 * **`metadataJwt` is required, not optional.** If the mint failed, the caller
 * must abort rather than send an entry without it: a `transaction_data` type
 * that no credential's metadata declares, carrying no override, is PaSO Core
 * §7.4.2 "incompatible" — best case the wallet refuses, worst case it renders
 * `old_limit: EUR 1000.00` to a human, which looks like the feature working.
 */
export function buildLimitChangeTransactionData(input: {
  oldLimitCents: number;
  newLimitCents: number;
  metadataJwt: string;
}): unknown[] {
  return [
    {
      type: LIMIT_CHANGE_TRANSACTION_DATA_TYPE,
      credential_ids: [SPARKASSEN_AUTH_QUERY_ID],
      transaction_data_hashes_alg: ["sha-256"],
      payload: {
        old_limit: limitAmountString(input.oldLimitCents),
        new_limit: limitAmountString(input.newLimitCents),
      },
      metadata: input.metadataJwt,
    },
  ];
}