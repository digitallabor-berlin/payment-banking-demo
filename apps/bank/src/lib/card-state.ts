import type { CardCredentialState } from "./queries.js";

/**
 * What the card face shows. Deliberately the same three names as
 * CardCredentialState, because it answers a different question with the same
 * vocabulary: that type is what the database holds, this one is what the user
 * is looking at.
 */
export type CardFaceState = "none" | "offered" | "active";

export interface CardFaceCopy {
 badge: string;
 badgeClass: string;
 explain: string;
}

export const STATE_COPY: Record<CardFaceState, CardFaceCopy> = {
 none: {
  badge: "Nicht im Wallet",
  badgeClass: "badge-neutral",
  explain:
   "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
 },
 offered: {
  badge: "Wird hinzugefügt…",
  badgeClass: "badge-wallet",
  explain: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
 },
 active: {
  badge: "Im Wallet",
  badgeClass: "badge-success",
  explain: "Diese Karte ist in Ihrem EUDI Wallet und für Zahlungen bereit.",
 },
};

/**
 * Collapse the persisted credential state and the live browser session into
 * the one state the card face draws.
 *
 * "offered" is session-scoped on purpose. No code path in this project ever
 * clears an offered credential row — there is no revocation anywhere, and a
 * credential merely expires on its 12-hour lifetime without the row changing —
 * so treating a persisted offer as "in flight" meant one abandoned attempt
 * pinned the card to "Wird hinzugefügt…", sheen animation included, on every
 * page load thereafter. An offer is in flight only while this browser is
 * driving it, which is what `issuing` reports.
 *
 * The cost is accepted: a genuinely open offer becomes invisible after a
 * reload. That is the better failure, because the wallet leg cannot complete
 * in this demo's environment, so a server-derived "in flight" state is one
 * that in practice only ever gets stuck.
 *
 * This lives in a .ts file rather than inside CardTile's JSX because every
 * vitest project here is `environment: "node"` with
 * `include: ["src/**\/*.test.ts"]` — a decision made in a .tsx file is never
 * covered by a test.
 */
export function cardFaceState(
 persisted: CardCredentialState,
 issuing: boolean,
): CardFaceState {
 if (persisted === "active") return "active";
 return issuing ? "offered" : "none";
}
