import { describe, expect, it } from "vitest";
import { STATE_COPY, cardFaceState } from "./card-state.js";

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

describe("STATE_COPY", () => {
  it("labels the none state as not yet in the wallet", () => {
    expect(STATE_COPY.none.badge).toBe("Nicht im Wallet");
  });

  it("labels the offered state as in progress", () => {
    expect(STATE_COPY.offered.badge).toBe("Wird hinzugefügt…");
  });

  it("labels the active state as in the wallet", () => {
    expect(STATE_COPY.active.badge).toBe("Im Wallet");
  });

  it("explains every face state", () => {
    for (const copy of Object.values(STATE_COPY)) {
      expect(copy.explain.length).toBeGreaterThan(0);
      expect(copy.badgeClass).toMatch(/^badge-/);
    }
  });
});
