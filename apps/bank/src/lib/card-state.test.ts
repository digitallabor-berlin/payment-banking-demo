import { describe, expect, it } from "vitest";
import { cardFaceState, stateCopy } from "./card-state.js";
import { BADGE_CLASS } from "./credential-copy.js";

describe("cardFaceState", () => {
  it("reports active for a live credential", () => {
    expect(cardFaceState("active", false)).toBe("active");
  });

  it("keeps active while a further issuance is in flight", () => {
    expect(cardFaceState("active", true)).toBe("active");
  });

  it("reports offered while the user is issuing a card with no credential", () => {
    expect(cardFaceState("none", true)).toBe("offered");
  });

  it("reports offered while the user is re-issuing over a stale offer", () => {
    expect(cardFaceState("offered", true)).toBe("offered");
  });

  /*
   * The defect this function exists to fix. Nothing in this project ever
   * clears an "offered" credential row — there is no revocation anywhere — so
   * a single abandoned attempt used to leave the card showing "Wird
   * hinzugefügt…" and running its sheen animation on every subsequent page
   * load, forever. An offer is only in flight while this browser session is
   * driving it.
   */
  it("ignores a persisted offer when the user is not issuing", () => {
    expect(cardFaceState("offered", false)).toBe("none");
  });

  it("reports none for a card that was never offered", () => {
    expect(cardFaceState("none", false)).toBe("none");
  });
});

describe("stateCopy", () => {
  it("labels the none state as not yet in the wallet", () => {
    expect(stateCopy("de", "none").badge).toBe("Nicht im Wallet");
  });

  it("labels the offered state as in progress", () => {
    expect(stateCopy("de", "offered").badge).toBe("Wird hinzugefügt…");
  });

  it("labels the active state as in the wallet", () => {
    expect(stateCopy("de", "active").badge).toBe("Im Wallet");
  });

  it("explains every face state", () => {
    for (const state of ["none", "offered", "active"] as const) {
      expect(stateCopy("de", state).explain.length).toBeGreaterThan(0);
      // badgeClass is no longer part of the copy — a CSS class has no
      // language. It lives in BADGE_CLASS, keyed by state alone.
      expect(BADGE_CLASS[state]).toMatch(/^badge-/);
    }
  });

  it("returns English face copy for the card", () => {
    // Wallet-neutral on purpose: the card reaches a wallet through either of
    // the tile's two buttons, and one badge describes both.
    expect(stateCopy("en", "active").explain).toBe(
      "This card is in your wallet and ready for payments. You can add it again at any time.",
    );
  });
});
