import { describe, expect, it } from "vitest";
import {
  BADGE_CLASS,
  DIALOG_COPY,
  FACE_COPY,
  dialogCopy,
  faceCopy,
  walletActionLabel,
  type CredentialKind,
  type IssuanceFlavour,
} from "./credential-copy.js";
import { stateCopy, type CardFaceState } from "./card-state.js";
import { MESSAGES } from "./i18n/messages.js";

const STATES: CardFaceState[] = ["none", "offered", "active"];
const KINDS: CredentialKind[] = ["card", "age"];
const FLAVOURS: IssuanceFlavour[] = ["card-eudi", "card-google", "age"];

describe("FACE_COPY", () => {
  it("covers every face state for both credential kinds", () => {
    for (const kind of KINDS) {
      for (const state of STATES) {
        const copy = faceCopy("de", kind, state);
        expect(copy.badge.length).toBeGreaterThan(0);
        expect(copy.explain.length).toBeGreaterThan(0);
      }
    }
  });

  it("is what card-state's stateCopy still exposes for the card", () => {
    // stateCopy is the card's own accessor and predates this module; it must
    // keep returning the same object rather than a parallel copy of it.
    for (const state of STATES) {
      expect(stateCopy("de", state)).toEqual(FACE_COPY.de.card[state]);
    }
  });

  it("is keyed by kind, not by credential type id", () => {
    // The girocard is issued in two formats behind ONE tile with ONE badge.
    // Keying this by type id would duplicate every card string and let the two
    // formats' copy drift apart for no reason a user could ever observe.
    expect(Object.keys(FACE_COPY.de).sort()).toEqual(["age", "card"]);
    expect(Object.keys(FACE_COPY.en).sort()).toEqual(["age", "card"]);
  });

  it("explains the two credentials differently wherever the subject differs", () => {
    // The 'offered' instruction is deliberately shared -- see below -- so the
    // distinction is asserted on the two states that describe the subject.
    for (const state of ["none", "active"] as const) {
      expect(faceCopy("de", "age", state).explain).not.toBe(
        faceCopy("de", "card", state).explain,
      );
    }
  });

  it("shares the offered instruction between both credentials, on purpose", () => {
    // Both say "confirm the offer in your wallet app" -- the sentence does not
    // name its subject, so duplicating it per kind would be pointless drift
    // waiting to happen. Asserted so a future edit to one is a failing test
    // rather than a silent divergence.
    expect(faceCopy("de", "card", "offered").explain).toBe(
      "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
    );
    expect(faceCopy("de", "age", "offered").explain).toBe(
      "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
    );
  });

  it("shares the offered instruction in English too", () => {
    expect(faceCopy("en", "card", "offered").explain).toBe(
      "Confirm the offer in your wallet app.",
    );
    expect(faceCopy("en", "age", "offered").explain).toBe(
      "Confirm the offer in your wallet app.",
    );
  });

  it("invites a re-add from the active state, in both languages", () => {
    // The active tile is not a dead end: the button offers "add again", so the
    // explanation must not read as though the credential is now untouchable.
    for (const kind of KINDS) {
      expect(faceCopy("en", kind, "active").explain).toMatch(/again/i);
      expect(faceCopy("de", kind, "active").explain).toMatch(/erneut/i);
    }
  });

  it("uses the German the card tile shipped with", () => {
    expect(faceCopy("de", "card", "none").explain).toBe(
      "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
    );
    expect(faceCopy("de", "card", "active").badge).toBe("Im Wallet");
  });

  it("does not name a single wallet in the card's active state", () => {
    // The card can reach a wallet through either button, and the tile shows one
    // badge for both. Saying "EUDI Wallet" here would be wrong half the time.
    expect(faceCopy("en", "card", "active").explain).not.toMatch(/EUDI/);
    expect(faceCopy("de", "card", "active").explain).not.toMatch(/EUDI/);
  });
});

describe("DIALOG_COPY", () => {
  it("uses the card dialog's original German strings for the EUDI handover", () => {
    expect(dialogCopy("de", "card-eudi")).toEqual({
      title: "Karte zum EUDI Wallet hinzufügen",
      successTitle: "Karte hinzugefügt",
      successBody: "Ihre Karte ist jetzt in Ihrem EUDI Wallet.",
      failureBody: "Die Karte konnte nicht hinzugefügt werden.",
    });
  });

  it("names Google Wallet in the Google flavour's title, in both languages", () => {
    // The whole reason this dimension exists: a dialog reading "Add card to
    // EUDI Wallet" over a handover started from a Google Wallet badge is wrong.
    expect(dialogCopy("en", "card-google").title).toBe(
      "Add card to Google Wallet",
    );
    expect(dialogCopy("de", "card-google").title).toBe(
      "Karte zu Google Wallet hinzufügen",
    );
  });

  it("never claims a specific wallet received the credential", () => {
    // An OpenID4VCI offer can be answered by any wallet on the device. The
    // title states an intent, which is knowable; the success body would be
    // stating an outcome, which is not.
    for (const locale of ["de", "en"] as const) {
      expect(dialogCopy(locale, "card-google").successBody).not.toMatch(
        /Google/,
      );
    }
  });

  it("gives the two card flavours different titles but the same failure", () => {
    for (const locale of ["de", "en"] as const) {
      const eudi = dialogCopy(locale, "card-eudi");
      const google = dialogCopy(locale, "card-google");
      expect(eudi.title).not.toBe(google.title);
      // Both failed to add the same card. A different sentence would imply a
      // difference the user has no way to act on.
      expect(eudi.failureBody).toBe(google.failureBody);
    }
  });

  it("covers every flavour in both locales", () => {
    for (const locale of ["de", "en"] as const) {
      expect(Object.keys(DIALOG_COPY[locale]).sort()).toEqual(
        [...FLAVOURS].sort(),
      );
    }
  });

  it("never reuses a face string for the age credential's dialog", () => {
    const age = dialogCopy("de", "age");
    const faceStrings = new Set(
      STATES.flatMap((state) => [
        faceCopy("de", "age", state).badge,
        faceCopy("de", "age", state).explain,
      ]),
    );
    // A dialog string equal to a face string would mean one of them is wrong.
    for (const value of Object.values(age)) {
      expect(faceStrings.has(value)).toBe(false);
    }
  });

  it("distinguishes the card and age subjects in every dialog string", () => {
    for (const locale of ["de", "en"] as const) {
      const card = DIALOG_COPY[locale]["card-eudi"];
      const age = DIALOG_COPY[locale].age;
      for (const key of Object.keys(card) as (keyof typeof card)[]) {
        expect(card[key]).not.toBe(age[key]);
      }
    }
  });
});

describe("English copy", () => {
  it("uses the English badge for the card", () => {
    expect(faceCopy("en", "card", "none").badge).toBe("Not in wallet");
  });

  it("uses the English badge for the age credential", () => {
    expect(faceCopy("en", "age", "active").badge).toBe("In wallet");
  });

  it("uses the English dialog title for the card", () => {
    expect(dialogCopy("en", "card-eudi").title).toBe("Add card to EUDI Wallet");
  });

  it("distinguishes the two subjects in the English dialog", () => {
    expect(dialogCopy("en", "card-eudi").successTitle).not.toBe(
      dialogCopy("en", "age").successTitle,
    );
  });
});

describe("BADGE_CLASS", () => {
  it("has a class for every face state", () => {
    for (const state of STATES) {
      expect(BADGE_CLASS[state].length).toBeGreaterThan(0);
    }
  });
});

describe("walletActionLabel", () => {
  it("offers to add when nothing is in the wallet", () => {
    expect(walletActionLabel("en", "none", false)).toBe(
      MESSAGES.en.issuance.addToWallet,
    );
  });

  it("offers to add again once the credential is live", () => {
    // Re-issuance is permitted everywhere behind the UI, so an active
    // credential gets its own label rather than a disabled button.
    expect(walletActionLabel("en", "active", false)).toBe(
      MESSAGES.en.issuance.addAgain,
    );
  });

  it("reports progress while a request is in flight, whatever the state", () => {
    for (const state of STATES) {
      expect(walletActionLabel("de", state, true)).toBe(
        MESSAGES.de.issuance.preparing,
      );
    }
  });

  it("is translated", () => {
    expect(walletActionLabel("de", "none", false)).not.toBe(
      walletActionLabel("en", "none", false),
    );
  });
});

describe("the Google Wallet badge's accessible name", () => {
  it("exists in both locales", () => {
    // The badge is artwork whose text is drawn as SVG paths, so this string is
    // never rendered — it is the button's accessible name and nothing else.
    expect(MESSAGES.en.issuance.addToGoogleWallet).toBe("Add to Google Wallet");
    expect(MESSAGES.de.issuance.addToGoogleWallet).toBe(
      "Zu Google Wallet hinzufügen",
    );
  });

  it("names Google Wallet rather than the EUDI Wallet", () => {
    for (const locale of ["de", "en"] as const) {
      expect(MESSAGES[locale].issuance.addToGoogleWallet).toMatch(/Google/);
      expect(MESSAGES[locale].issuance.addToGoogleWallet).not.toMatch(/EUDI/);
    }
  });
});
