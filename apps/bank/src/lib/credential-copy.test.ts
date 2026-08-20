import { describe, expect, it } from "vitest";
import { stateCopy } from "./card-state.js";
import {
  BADGE_CLASS,
  FACE_COPY,
  dialogCopy,
  faceCopy,
} from "./credential-copy.js";
import {
  AV_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
} from "./credential-types.js";

describe("FACE_COPY", () => {
  it("covers every face state for both credential types", () => {
    for (const type of [
      DPC_CREDENTIAL_TYPE_ID,
      AV_CREDENTIAL_TYPE_ID,
    ] as const) {
      for (const state of ["none", "offered", "active"] as const) {
        const copy = faceCopy("de", type, state);
        expect(copy.badge.length).toBeGreaterThan(0);
        expect(copy.explain.length).toBeGreaterThan(0);
      }
    }
  });

  it("is what card-state's stateCopy still exposes for the card", () => {
    // The card's copy moved here rather than changing; this guards the move.
    // Identity, not equality: stateCopy must be reading this very record, not
    // a parallel copy of it that could drift.
    for (const state of ["none", "offered", "active"] as const) {
      expect(stateCopy("de", state)).toBe(
        FACE_COPY.de[DPC_CREDENTIAL_TYPE_ID][state],
      );
    }
  });

  it("explains the two credentials differently wherever the subject differs", () => {
    // "none" and "active" name the credential and what it is for, so they must
    // diverge. "offered" is deliberately NOT in this list -- see below.
    for (const state of ["none", "active"] as const) {
      expect(faceCopy("de", AV_CREDENTIAL_TYPE_ID, state).explain).not.toBe(
        faceCopy("de", DPC_CREDENTIAL_TYPE_ID, state).explain,
      );
    }
  });

  it("shares the offered instruction between both credentials, on purpose", () => {
    // The plan's test asserted all three states differ, but the plan's own copy
    // table -- and spec 6.1 -- give both types this identical string, so that
    // assertion was unsatisfiable against its own data. It is identical because
    // the instruction genuinely is: an offer in flight is confirmed in the
    // wallet app regardless of what is being offered. Pinned rather than
    // dropped so a future edit to one type's string has to justify itself here.
    const shared = "Bestätigen Sie das Angebot in Ihrer Wallet-App.";
    expect(faceCopy("de", DPC_CREDENTIAL_TYPE_ID, "offered").explain).toBe(
      shared,
    );
    expect(faceCopy("de", AV_CREDENTIAL_TYPE_ID, "offered").explain).toBe(
      shared,
    );
  });

  // The same property in English. Checked independently rather than by
  // comparing the two locales, so neither language's sharing can drift.
  it("shares the offered instruction in English too", () => {
    const shared = "Confirm the offer in your wallet app.";
    expect(faceCopy("en", DPC_CREDENTIAL_TYPE_ID, "offered").explain).toBe(
      shared,
    );
    expect(faceCopy("en", AV_CREDENTIAL_TYPE_ID, "offered").explain).toBe(
      shared,
    );
  });

  it("keeps the card's own copy verbatim", () => {
    expect(faceCopy("de", DPC_CREDENTIAL_TYPE_ID, "none").explain).toBe(
      "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
    );
    expect(faceCopy("de", DPC_CREDENTIAL_TYPE_ID, "active").badge).toBe(
      "Im Wallet",
    );
  });
});

describe("DIALOG_COPY", () => {
  it("keeps the card dialog's strings exactly as they were", () => {
    expect(dialogCopy("de", DPC_CREDENTIAL_TYPE_ID)).toEqual({
      title: "Karte zum EUDI Wallet hinzufügen",
      successTitle: "Karte hinzugefügt",
      successBody: "Ihre Karte ist jetzt in Ihrem EUDI Wallet.",
      failureBody: "Die Karte konnte nicht hinzugefügt werden.",
    });
  });

  it("never calls the age credential a Karte", () => {
    // German gender is why this is a copy record and not a noun substitution:
    // "die Karte" but "der Altersnachweis".
    const av = dialogCopy("de", AV_CREDENTIAL_TYPE_ID);
    const strings = [
      ...Object.values(av),
      ...(["none", "offered", "active"] as const).flatMap((state) => [
        faceCopy("de", AV_CREDENTIAL_TYPE_ID, state).badge,
        faceCopy("de", AV_CREDENTIAL_TYPE_ID, state).explain,
      ]),
    ];
    for (const value of strings) {
      expect(value.toLowerCase()).not.toContain("karte");
    }
    expect(av.failureBody).toBe(
      "Der Altersnachweis konnte nicht hinzugefügt werden.",
    );
  });
});

describe("English credential copy", () => {
  it("names the card's inactive state in English", () => {
    expect(faceCopy("en", DPC_CREDENTIAL_TYPE_ID, "none").badge).toBe(
      "Not in wallet",
    );
  });

  it("names the age credential's active state in English", () => {
    expect(faceCopy("en", AV_CREDENTIAL_TYPE_ID, "active").badge).toBe(
      "In wallet",
    );
  });

  it("titles the card dialog in English", () => {
    expect(dialogCopy("en", DPC_CREDENTIAL_TYPE_ID).title).toBe(
      "Add card to EUDI Wallet",
    );
  });

  it("distinguishes the two credential types in the English dialog", () => {
    expect(dialogCopy("en", DPC_CREDENTIAL_TYPE_ID).successTitle).not.toBe(
      dialogCopy("en", AV_CREDENTIAL_TYPE_ID).successTitle,
    );
  });

  // The same half-finished-translation guard messages.test.ts applies to the
  // catalog. credential-copy is not part of that catalog, so it needs its own.
  it("translates every face string away from the German", () => {
    for (const typeId of [
      DPC_CREDENTIAL_TYPE_ID,
      AV_CREDENTIAL_TYPE_ID,
    ] as const) {
      for (const state of ["none", "offered", "active"] as const) {
        const en = faceCopy("en", typeId, state);
        const de = faceCopy("de", typeId, state);
        expect(en.badge).not.toBe(de.badge);
        expect(en.explain).not.toBe(de.explain);
        expect(en.badge).not.toMatch(/[äöüßÄÖÜ]/);
        expect(en.explain).not.toMatch(/[äöüßÄÖÜ]/);
      }
    }
  });

  it("translates every dialog string away from the German", () => {
    for (const typeId of [
      DPC_CREDENTIAL_TYPE_ID,
      AV_CREDENTIAL_TYPE_ID,
    ] as const) {
      const en = dialogCopy("en", typeId);
      const de = dialogCopy("de", typeId);
      for (const key of [
        "title",
        "successTitle",
        "successBody",
        "failureBody",
      ] as const) {
        expect(en[key]).not.toBe(de[key]);
        expect(en[key]).not.toMatch(/[äöüßÄÖÜ]/);
      }
    }
  });
});

describe("badge classes", () => {
  // A CSS class is not copy. Keeping it inside the locale-keyed record would
  // store "badge-success" twice and let the two locales drift on a value that
  // has no language.
  it("is one value per face state, independent of locale", () => {
    expect(BADGE_CLASS.none).toBe("badge-neutral");
    expect(BADGE_CLASS.offered).toBe("badge-wallet");
    expect(BADGE_CLASS.active).toBe("badge-success");
  });
});
