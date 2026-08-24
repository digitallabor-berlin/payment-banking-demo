import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FoundryClient } from "@demo/foundry-client";
import type { Db } from "../db/index.js";
import { credentials } from "../db/schema.js";
import type { AgeCredentialTypeId } from "./credential-types.js";

/**
 * The claims the age credential carries. Booleans, and only these two: an age
 * attestation that also carried a birthdate would defeat its own purpose, and
 * it carries no identifier either, so nothing about it is correlatable.
 *
 * foundry's mdoc issuance path puts every flat key into one namespace equal to
 * the resolved docType, so these become `eu.europa.ec.av.1 -> { … }` — exactly
 * what the deployed `av` named query asks for.
 */
export const AV_CLAIMS = {
     age_over_16: true,
     age_over_18: true,
} as const;

export type StartAvIssuanceResult =
     | { ok: true; sessionId: string; offerUri: string; dcApiOffer: unknown }
     | { ok: false; reason: "foundry_unavailable" };

/**
 * Offers the user an age-verification credential.
 *
 * A deliberate sibling of `startIssuance` rather than a branch inside it. The
 * payment path joins `accounts` for an IBAN, derives `card.last_four`, builds
 * two display arrays and can fail with `card_not_found`; none of that exists
 * here. One function serving both would branch on nearly every line — the two
 * share a shape, not a body.
 *
 * Sends NO `offer_display` and NO `credential_response_display`. foundry gates
 * both on the DPC's vct (`create_offer.rs`) and rejects them outright for any
 * other credential type, so the wallet's rendering of this credential comes
 * entirely from foundry's own static `display:` config. `public/av-face.svg` is
 * the bank's own UI artwork and is never sent anywhere.
 *
 * The row is written BEFORE foundry is called, so a foundry outage — or a
 * foundry with neither age credential type configured — leaves a visible
 * `failed` row rather than nothing at all.
 *
 * `credentialTypeId` picks which of the two age formats to offer, and is the
 * ONLY thing that differs between them: the claims are shared verbatim, because
 * the two are one attestation in two wrappers rather than two attestations. It
 * is a required parameter rather than a defaulted one so a caller that forgets
 * it is a compile error instead of a silent EUDI issuance — the same reasoning
 * that gives `startIssuance` its explicit format argument.
 */
export async function startAvIssuance(
     db: Db,
     client: FoundryClient,
     userId: string,
     credentialTypeId: AgeCredentialTypeId,
     now: number = Date.now(),
): Promise<StartAvIssuanceResult> {
     const rowId = `cred_${randomUUID()}`;

     db.insert(credentials)
          .values({
               id: rowId,
               userId,
               // No card: this credential attests a property of the person.
               cardId: null,
               credentialTypeId,
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
               credential_type_id: credentialTypeId,
               claims: { ...AV_CLAIMS },
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
