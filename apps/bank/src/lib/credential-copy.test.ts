import { describe, expect, it } from "vitest";
import { STATE_COPY } from "./card-state.js";
import { DIALOG_COPY, FACE_COPY } from "./credential-copy.js";
import {
  AV_CREDENTIAL_TYPE_ID,
  DPC_CREDENTIAL_TYPE_ID,
} from "./credential-types.js";

describe("FACE_COPY", () => {
  it("covers every face state for both credential types", () => {
    for (const type of [DPC_CREDENTIAL_TYPE_ID, AV_CREDENTIAL_TYPE_ID] as const) {
      for (const state of ["none", "offered", "active"] as const) {
        const copy = FACE_COPY[type][state];
        expect(copy.badge.length).toBeGreaterThan(0);
        expect(copy.badgeClass.length).toBeGreaterThan(0);
        expect(copy.explain.length).toBeGreaterThan(0);
      }
    }
  });

  it("is what card-state's STATE_COPY still exposes for the card", () => {
    // The card's copy moved here rather than changing; this guards the move.
    expect(STATE_COPY).toBe(FACE_COPY[DPC_CREDENTIAL_TYPE_ID]);
  });

  it("explains the two credentials differently wherever the subject differs", () => {
    // "none" and "active" name the credential and what it is for, so they must
    // diverge. "offered" is deliberately NOT in this list -- see below.
    for (const state of ["none", "active"] as const) {
      expect(FACE_COPY[AV_CREDENTIAL_TYPE_ID][state].explain).not.toBe(
        FACE_COPY[DPC_CREDENTIAL_TYPE_ID][state].explain,
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
    expect(FACE_COPY[DPC_CREDENTIAL_TYPE_ID].offered.explain).toBe(shared);
    expect(FACE_COPY[AV_CREDENTIAL_TYPE_ID].offered.explain).toBe(shared);
  });

  it("keeps the card's own copy verbatim", () => {
    expect(FACE_COPY[DPC_CREDENTIAL_TYPE_ID].none.explain).toBe(
      "Fügen Sie diese Karte Ihrem EUDI Wallet hinzu, um online zu bezahlen.",
    );
    expect(FACE_COPY[DPC_CREDENTIAL_TYPE_ID].active.badge).toBe("Im Wallet");
  });
});

describe("DIALOG_COPY", () => {
  it("keeps the card dialog's strings exactly as they were", () => {
    expect(DIALOG_COPY[DPC_CREDENTIAL_TYPE_ID]).toEqual({
      title: "Karte zum EUDI Wallet hinzufügen",
      successTitle: "Karte hinzugefügt",
      successBody: "Ihre Karte ist jetzt in Ihrem EUDI Wallet.",
      failureBody: "Die Karte konnte nicht hinzugefügt werden.",
    });
  });

  it("never calls the age credential a Karte", () => {
    // German gender is why this is a copy record and not a noun substitution:
    // "die Karte" but "der Altersnachweis".
    const av = DIALOG_COPY[AV_CREDENTIAL_TYPE_ID];
    const strings = [
      ...Object.values(av),
      ...(["none", "offered", "active"] as const).flatMap((state) => [
        FACE_COPY[AV_CREDENTIAL_TYPE_ID][state].badge,
        FACE_COPY[AV_CREDENTIAL_TYPE_ID][state].explain,
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