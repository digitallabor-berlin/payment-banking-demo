import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import { SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID } from "./credential-types.js";

export type StartAuthenticatorIssuanceResult =
  | { ok: true; sessionId: string; offerUri: string; dcApiOffer: unknown }
  | { ok: false; reason: "foundry_unavailable" };

/**
 * Offers the user a Sparkassen Authenticator credential.
 *
 * A sibling of `startAvIssuance` rather than a branch inside `startIssuance`,
 * for that function's own stated reason: the payment path joins `accounts` for
 * an IBAN, derives `card.last_four`, builds two display arrays and can fail
 * with `card_not_found`, and none of that exists here. This shares a shape with
 * the age path, not a body — but it is a separate function from that one too,
 * because the two share no claims and mean different things.
 *
 * The claim set is ONE claim: a `sub` UUID, minted here, sent, and never
 * persisted. Nothing resolves a credential by it, so a column would be an
 * identifier the bank kept for no purpose — the same treatment `startIssuance`
 * gives its own `sub`. Minting it per issuance is also what keeps two
 * authenticator credentials from being correlatable to each other.
 *
 * Sends NO `offer_display` and NO `credential_response_display`. foundry gates
 * both on the DPC's vct (`create_offer.rs`) and rejects them outright for any
 * other credential type, so the wallet's rendering of this credential comes
 * entirely from foundry's own static `display:` config. The `#EA0016` face in
 * the bank's UI is never sent anywhere.
 *
 * The row is written BEFORE foundry is called, so a foundry outage — or, as of
 * 2026-08-24, ANY foundry, since no config declares `sparkassen_auth` — leaves
 * a visible `failed` row rather than nothing at all.
 *
 * Takes no credential-type parameter, unlike `startIssuance` and
 * `startAvIssuance`. Those two each offer their credential in two formats and
 * must be told which; this one is offered for the EUDI Wallet alone, so there
 * is nothing to choose and a parameter would only admit a wrong value.
 */
export async function startAuthenticatorIssuance(
  db: Db,
  client: FoundryClient,
  userId: string,
  now: number = Date.now(),
): Promise<StartAuthenticatorIssuanceResult> {
  const rowId = `cred_${randomUUID()}`;

  db.insert(credentials)
    .values({
      id: rowId,
      userId,
      // No card: this credential attests that the person is who they say
      // they are. It is not payable, so there is nothing to debit through.
      cardId: null,
      credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
      // No payment join key, and none is disclosed to anyone.
      credentialId: null,
      foundryTxId: null,
      state: "offered",
      issuedAt: null,
      createdAt: now,
    })
    .run();

  try {
    const offer = await client.createIssuanceOffer({
      credential_type_id: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
      // Sent, never stored — see the note above.
      claims: { sub: randomUUID() },
    });

    db.update(credentials)
      .set({ foundryTxId: offer.transaction_id })
      .where(eq(credentials.id, rowId))
      .run();

    // Two renderings of ONE offer: the deep link and the DC API payload.
    // dcApiOffer is deliberately not persisted — the offer is already recorded
    // by foundryTxId, so a column would duplicate state.
    return {
      ok: true,
      sessionId: rowId,
      offerUri: offer.credential_offer_uri,
      dcApiOffer: offer.dc_api_offer,
    };
  } catch {
    db.update(credentials)
      .set({ state: "failed" })
      .where(eq(credentials.id, rowId))
      .run();
    return { ok: false, reason: "foundry_unavailable" };
  }
}
