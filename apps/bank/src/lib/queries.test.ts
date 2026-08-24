import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/index.js";
import { credentials, transactions } from "../db/schema.js";
import { seed } from "../db/seed.js";
import {
  AGE_CREDENTIAL_TYPE_IDS,
  AV_CREDENTIAL_TYPE_ID,
  AV_GOOGLE_CREDENTIAL_TYPE_ID,
  SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
  type AgeCredentialTypeId,
} from "./credential-types.js";
import {
  getAgeCredentialState,
  getAuthenticatorCredentialState,
  getWeroCredentialState,
  listAccounts,
  listCards,
  listTransactions,
  type CardCredentialState,
} from "./queries.js";

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bank-q-"));
  db = createDb(path.join(dir, "test.db"));
  seed(db);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("listAccounts", () => {
  it("returns only the requesting user's accounts", () => {
    const anna = listAccounts(db, "user_anna");
    expect(anna).toHaveLength(1);
    expect(anna[0]?.id).toBe("acc_anna");
    expect(anna[0]?.balanceCents).toBe(348_712);
  });

  it("returns an empty array for an unknown user", () => {
    expect(listAccounts(db, "user_nobody")).toEqual([]);
  });

  it("never leaks another user's account", () => {
    expect(listAccounts(db, "user_ben").map((a) => a.id)).toEqual(["acc_ben"]);
  });
});

describe("listCards", () => {
  it("reports credentialState 'none' when no credential exists", () => {
    const cards = listCards(db, "user_anna");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.credentialState).toBe("none");
    expect(cards[0]?.credentialRowId).toBeNull();
    expect(cards[0]?.panLast4).toBe("4242");
    expect(cards[0]?.network).toBe("girocard");
  });

  it("reports 'offered' while issuance is pending", () => {
    db.insert(credentials)
      .values({
        id: "cred_1",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_1",
        foundryTxId: "tx_1",
        state: "offered",
        issuedAt: null,
        createdAt: 1,
      })
      .run();
    const cards = listCards(db, "user_anna");
    expect(cards[0]?.credentialState).toBe("offered");
    expect(cards[0]?.credentialRowId).toBe("cred_1");
  });

  it("reports 'active' once issued", () => {
    db.insert(credentials)
      .values({
        id: "cred_2",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_2",
        foundryTxId: "tx_2",
        state: "active",
        issuedAt: 100,
        createdAt: 50,
      })
      .run();
    expect(listCards(db, "user_anna")[0]?.credentialState).toBe("active");
  });

  /*
   * This used to assert the opposite -- newest non-failed row wins, full stop --
   * and that was only safe while the UI forbade a second issuance. Once an "add
   * again" button exists, one abandoned re-issue writes an `offered` row that
   * outranks the `active` one forever (nothing in this project ever clears an
   * offered row), and the card then claims "Not in wallet" while the credential
   * is demonstrably in the wallet. Observed in a real browser, not theorised.
   *
   * An issued credential is a fact; an offer is an intention. A re-issue only
   * supersedes its predecessor once it becomes active itself.
   */
  it("does not let a newer offer mask a credential already in the wallet", () => {
    db.insert(credentials)
      .values({
        id: "cred_old",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_old",
        state: "active",
        issuedAt: 10,
        createdAt: 10,
      })
      .run();
    db.insert(credentials)
      .values({
        id: "cred_new",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_new",
        state: "offered",
        issuedAt: null,
        createdAt: 20,
      })
      .run();
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialState).toBe("active");
    expect(card?.credentialRowId).toBe("cred_old");
  });

  it("prefers the newest credential among several in the wallet", () => {
    for (const [id, createdAt] of [
      ["cred_first", 10],
      ["cred_second", 20],
    ] as const) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: "card_anna",
          credentialId: `dpc_${id}`,
          state: "active",
          issuedAt: createdAt,
          createdAt,
        })
        .run();
    }
    expect(listCards(db, "user_anna")[0]?.credentialRowId).toBe("cred_second");
  });

  it("prefers the newest offer when nothing is in the wallet yet", () => {
    for (const [id, createdAt] of [
      ["cred_o1", 10],
      ["cred_o2", 20],
    ] as const) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: "card_anna",
          credentialId: `dpc_${id}`,
          state: "offered",
          issuedAt: null,
          createdAt,
        })
        .run();
    }
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialState).toBe("offered");
    expect(card?.credentialRowId).toBe("cred_o2");
  });

  it("ignores 'failed' credentials so a failed attempt shows as 'none'", () => {
    db.insert(credentials)
      .values({
        id: "cred_bad",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_bad",
        state: "failed",
        issuedAt: null,
        createdAt: 99,
      })
      .run();
    expect(listCards(db, "user_anna")[0]?.credentialState).toBe("none");
  });
});

describe("listCards per format", () => {
  /** Inserts one payment credential of a named format for anna's card. */
  function insertCard(
    id: string,
    credentialTypeId: "com.emvco.dpc.card" | "sparkassencard",
    state: "offered" | "active" | "failed",
    createdAt: number,
  ) {
    db.insert(credentials)
      .values({
        id,
        userId: "user_anna",
        cardId: "card_anna",
        credentialTypeId,
        credentialId: `key_${id}`,
        state,
        issuedAt: state === "active" ? createdAt : null,
        createdAt,
      })
      .run();
  }

  it("reports 'none' for both formats when nothing has been issued", () => {
    expect(listCards(db, "user_anna")[0]?.formats).toEqual({
      "com.emvco.dpc.card": "none",
      sparkassencard: "none",
    });
  });

  it("does not report the other format as issued when one is", () => {
    // The whole reason this field exists: the tile's two buttons must not
    // claim credit for each other's work.
    insertCard("cred_dpc", "com.emvco.dpc.card", "active", 10);
    expect(listCards(db, "user_anna")[0]?.formats).toEqual({
      "com.emvco.dpc.card": "active",
      sparkassencard: "none",
    });
  });

  it("reports the Sparkasse card independently of the DPC", () => {
    insertCard("cred_sk", "sparkassencard", "offered", 10);
    expect(listCards(db, "user_anna")[0]?.formats).toEqual({
      "com.emvco.dpc.card": "none",
      sparkassencard: "offered",
    });
  });

  it("reports both when the card is in the wallet twice", () => {
    insertCard("cred_dpc", "com.emvco.dpc.card", "active", 10);
    insertCard("cred_sk", "sparkassencard", "active", 20);
    expect(listCards(db, "user_anna")[0]?.formats).toEqual({
      "com.emvco.dpc.card": "active",
      sparkassencard: "active",
    });
  });

  it("applies 'active outranks offered' within a format, not across formats", () => {
    // A newer abandoned DPC offer must not demote the DPC's own active row,
    // and must not touch the Sparkasse card's answer at all.
    insertCard("cred_dpc_active", "com.emvco.dpc.card", "active", 10);
    insertCard("cred_dpc_offer", "com.emvco.dpc.card", "offered", 30);
    insertCard("cred_sk_offer", "sparkassencard", "offered", 20);
    expect(listCards(db, "user_anna")[0]?.formats).toEqual({
      "com.emvco.dpc.card": "active",
      sparkassencard: "offered",
    });
  });

  it("ignores a failed attempt per format", () => {
    insertCard("cred_sk_bad", "sparkassencard", "failed", 40);
    insertCard("cred_dpc", "com.emvco.dpc.card", "active", 10);
    expect(listCards(db, "user_anna")[0]?.formats).toEqual({
      "com.emvco.dpc.card": "active",
      sparkassencard: "none",
    });
  });

  it("shows the card face as 'active' when either format is in the wallet", () => {
    // The combined state is what draws the EU stars: the card is in a wallet,
    // and the face has no opinion about which format got it there.
    insertCard("cred_sk", "sparkassencard", "active", 10);
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialState).toBe("active");
    expect(card?.credentialRowId).toBe("cred_sk");
  });

  it("prefers an active row of either format over a newer offer of the other", () => {
    insertCard("cred_dpc_active", "com.emvco.dpc.card", "active", 10);
    insertCard("cred_sk_offer", "sparkassencard", "offered", 30);
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialState).toBe("active");
    expect(card?.credentialRowId).toBe("cred_dpc_active");
  });

  it("excludes a Wero credential from a card's formats", () => {
    // The reason CARD_FORMAT_TYPE_IDS exists. Unlike an age credential, a Wero
    // row DOES carry a card_id — it must, because it is payable — so the
    // card-scoped query would sweep it in without the explicit type filter, and
    // the girocard's face would read "In wallet" for a credential that is not a
    // girocard at all.
    db.insert(credentials)
      .values({
        id: "cred_wero",
        userId: "user_anna",
        cardId: "card_anna",
        credentialTypeId: "wero",
        credentialId: "key_wero",
        state: "active",
        issuedAt: 1,
        createdAt: 50,
      })
      .run();
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialState).toBe("none");
    expect(card?.credentialRowId).toBeNull();
    expect(card?.formats).toEqual({
      "com.emvco.dpc.card": "none",
      sparkassencard: "none",
    });
  });

  it("keys the record by exactly the two girocard formats", () => {
    // Wero is payable, so a record keyed by every payment type would gain a
    // third key here and the tile would grow a button for another instrument.
    expect(
      Object.keys(listCards(db, "user_anna")[0]?.formats ?? {}).sort(),
    ).toEqual(["com.emvco.dpc.card", "sparkassencard"]);
  });

  it("excludes an age credential from a card's formats", () => {
    // An age credential has no card_id, so it could never have been scoped in;
    // the explicit type filter makes that an assertion rather than a
    // coincidence of the data.
    db.insert(credentials)
      .values({
        id: "cred_av",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: "av-sparkasse",
        credentialId: null,
        state: "active",
        issuedAt: 1,
        createdAt: 50,
      })
      .run();
    const card = listCards(db, "user_anna")[0];
    expect(card?.credentialState).toBe("none");
    expect(card?.formats).toEqual({
      "com.emvco.dpc.card": "none",
      sparkassencard: "none",
    });
  });
});

describe("getWeroCredentialState", () => {
  /** Inserts one Wero credential for anna. It is payable, so it has a card. */
  function insertWero(
    id: string,
    state: "offered" | "active" | "failed",
    createdAt: number,
  ) {
    db.insert(credentials)
      .values({
        id,
        userId: "user_anna",
        cardId: "card_anna",
        credentialTypeId: "wero",
        credentialId: `key_${id}`,
        state,
        issuedAt: state === "active" ? createdAt : null,
        createdAt,
      })
      .run();
  }

  it("reports 'none' when the user has no Wero credential", () => {
    expect(getWeroCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
    });
  });

  it("reports 'offered' for an open offer", () => {
    insertWero("cred_wero", "offered", 10);
    expect(getWeroCredentialState(db, "user_anna")).toEqual({
      state: "offered",
      credentialRowId: "cred_wero",
    });
  });

  it("reports 'active' once the credential is issued", () => {
    insertWero("cred_wero", "active", 10);
    expect(getWeroCredentialState(db, "user_anna")).toEqual({
      state: "active",
      credentialRowId: "cred_wero",
    });
  });

  it("does not let a newer offer mask a credential already in the wallet", () => {
    // The same rule as every other tile: nothing in this project clears an
    // offered row, so one abandoned re-add would otherwise pin the tile to
    // "Not in wallet" forever.
    insertWero("cred_active", "active", 10);
    insertWero("cred_offer", "offered", 30);
    expect(getWeroCredentialState(db, "user_anna")).toEqual({
      state: "active",
      credentialRowId: "cred_active",
    });
  });

  it("prefers the newest row within one state, so a re-issue supersedes", () => {
    insertWero("cred_old", "active", 10);
    insertWero("cred_new", "active", 30);
    expect(getWeroCredentialState(db, "user_anna").credentialRowId).toBe(
      "cred_new",
    );
  });

  it("ignores failed rows, so a failed attempt reads as 'none'", () => {
    insertWero("cred_bad", "failed", 10);
    expect(getWeroCredentialState(db, "user_anna").state).toBe("none");
  });

  it("ignores the girocard's formats, however active they are", () => {
    // The mirror of listCards excluding Wero. Both are payment credentials on
    // the same card, so only the type filter tells them apart.
    db.insert(credentials)
      .values({
        id: "cred_dpc",
        userId: "user_anna",
        cardId: "card_anna",
        credentialTypeId: "com.emvco.dpc.card",
        credentialId: "key_dpc",
        state: "active",
        issuedAt: 1,
        createdAt: 50,
      })
      .run();
    expect(getWeroCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
    });
  });

  it("ignores an age credential", () => {
    db.insert(credentials)
      .values({
        id: "cred_av",
        userId: "user_anna",
        cardId: null,
        credentialTypeId: AV_CREDENTIAL_TYPE_ID,
        credentialId: null,
        state: "active",
        issuedAt: 1,
        createdAt: 50,
      })
      .run();
    expect(getWeroCredentialState(db, "user_anna").state).toBe("none");
  });

  it("never reports another user's Wero credential", () => {
    insertWero("cred_wero", "active", 10);
    expect(getWeroCredentialState(db, "user_ben").state).toBe("none");
  });

  it("exposes no per-format map, because Wero has one format", () => {
    // One EUDI button and no Google Wallet handover, so there is no second
    // format for a button to disagree with.
    insertWero("cred_wero", "active", 10);
    expect(getWeroCredentialState(db, "user_anna")).not.toHaveProperty(
      "formats",
    );
  });
});

describe("getAuthenticatorCredentialState", () => {
  /**
   * Inserts one authenticator credential for anna. Unlike Wero it has NO card
   * and no join key: it attests the person rather than an instrument, and it
   * cannot pay.
   */
  function insertAuth(
    id: string,
    state: "offered" | "active" | "failed",
    createdAt: number,
  ) {
    db.insert(credentials)
      .values({
        id,
        userId: "user_anna",
        cardId: null,
        credentialTypeId: SPARKASSEN_AUTH_CREDENTIAL_TYPE_ID,
        credentialId: null,
        state,
        issuedAt: state === "active" ? createdAt : null,
        createdAt,
      })
      .run();
  }

  it("reports 'none' when the user has no authenticator credential", () => {
    expect(getAuthenticatorCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
    });
  });

  it("reports 'offered' for an open offer", () => {
    insertAuth("cred_auth", "offered", 10);
    expect(getAuthenticatorCredentialState(db, "user_anna")).toEqual({
      state: "offered",
      credentialRowId: "cred_auth",
    });
  });

  it("reports 'active' once the credential is issued", () => {
    insertAuth("cred_auth", "active", 10);
    expect(getAuthenticatorCredentialState(db, "user_anna")).toEqual({
      state: "active",
      credentialRowId: "cred_auth",
    });
  });

  it("does not let a newer offer mask a credential already in the wallet", () => {
    // The same rule as every other tile: nothing in this project clears an
    // offered row, so one abandoned re-add would otherwise pin the tile to
    // "Not in wallet" forever.
    insertAuth("cred_active", "active", 10);
    insertAuth("cred_offer", "offered", 30);
    expect(getAuthenticatorCredentialState(db, "user_anna")).toEqual({
      state: "active",
      credentialRowId: "cred_active",
    });
  });

  it("prefers the newest row within one state, so a re-issue supersedes", () => {
    insertAuth("cred_old", "active", 10);
    insertAuth("cred_new", "active", 30);
    expect(
      getAuthenticatorCredentialState(db, "user_anna").credentialRowId,
    ).toBe("cred_new");
  });

  it("ignores failed rows, so a failed attempt reads as 'none'", () => {
    // Today's only reachable outcome: no foundry config declares
    // `sparkassen_auth`, so a real click writes exactly this row.
    insertAuth("cred_bad", "failed", 10);
    expect(getAuthenticatorCredentialState(db, "user_anna").state).toBe("none");
  });

  it("ignores every payment credential, however active", () => {
    for (const [id, typeId] of [
      ["cred_dpc", "com.emvco.dpc.card"],
      ["cred_sk", "sparkassencard"],
      ["cred_wero", "wero"],
    ] as const) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: "card_anna",
          credentialTypeId: typeId,
          credentialId: `key_${id}`,
          state: "active",
          issuedAt: 1,
          createdAt: 50,
        })
        .run();
    }
    expect(getAuthenticatorCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
    });
  });

  it("ignores both age formats, which share its card-less shape", () => {
    // The nearest miss: an age credential also has no card and no join key, so
    // only the type filter separates the two.
    for (const [id, typeId] of [
      ["cred_av_eudi", AV_CREDENTIAL_TYPE_ID],
      ["cred_av_google", AV_GOOGLE_CREDENTIAL_TYPE_ID],
    ] as const) {
      db.insert(credentials)
        .values({
          id,
          userId: "user_anna",
          cardId: null,
          credentialTypeId: typeId,
          credentialId: null,
          state: "active",
          issuedAt: 1,
          createdAt: 50,
        })
        .run();
    }
    expect(getAuthenticatorCredentialState(db, "user_anna").state).toBe("none");
  });

  it("never reports another user's authenticator credential", () => {
    insertAuth("cred_auth", "active", 10);
    expect(getAuthenticatorCredentialState(db, "user_ben").state).toBe("none");
  });

  it("exposes no per-format map, because the authenticator has one format", () => {
    // One EUDI button and no Google Wallet handover, exactly as with Wero.
    insertAuth("cred_auth", "active", 10);
    expect(getAuthenticatorCredentialState(db, "user_anna")).not.toHaveProperty(
      "formats",
    );
  });

  it("is invisible to the card and age queries", () => {
    // The reverse direction. A card-less, unpayable credential must not reach
    // the girocard's face or the age tile's badge.
    insertAuth("cred_auth", "active", 10);
    expect(listCards(db, "user_anna")[0]?.credentialState).toBe("none");
    expect(getAgeCredentialState(db, "user_anna").state).toBe("none");
  });
});

describe("listTransactions", () => {
  it("returns the newest transactions first", () => {
    const rows = listTransactions(db, "user_anna", 5, 0);
    expect(rows).toHaveLength(5);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1]!.bookedAt).toBeGreaterThanOrEqual(rows[i]!.bookedAt);
    }
  });

  it("honours limit and offset", () => {
    const first = listTransactions(db, "user_anna", 3, 0);
    const second = listTransactions(db, "user_anna", 3, 3);
    expect(first).toHaveLength(3);
    expect(second).toHaveLength(3);
    expect(first.map((r) => r.id)).not.toEqual(second.map((r) => r.id));
  });

  it("marks seeded history as not wallet-paid", () => {
    expect(
      listTransactions(db, "user_anna", 20, 0).every((r) => !r.paidWithWallet),
    ).toBe(true);
  });

  it("marks a transaction with a credential_id as wallet-paid", () => {
    db.insert(transactions)
      .values({
        id: "tx_wallet",
        accountId: "acc_anna",
        amountCents: -4_798,
        currency: "EUR",
        counterparty: "Demo Shop",
        reference: "Order #1",
        bookedAt: Date.now() + 1000,
        credentialId: "dpc_1",
        idempotencyKey: "sess_1",
      })
      .run();
    const newest = listTransactions(db, "user_anna", 1, 0)[0];
    expect(newest?.id).toBe("tx_wallet");
    expect(newest?.paidWithWallet).toBe(true);
  });

  it("never returns another user's transactions", () => {
    const ids = listTransactions(db, "user_ben", 50, 0).map((r) => r.id);
    expect(ids.every((id) => id.startsWith("tx_user_ben"))).toBe(true);
  });
});

/** Both age formats absent, for spreading into an expected DTO. */
const NO_AGE_FORMATS: Record<AgeCredentialTypeId, CardCredentialState> = {
  [AV_CREDENTIAL_TYPE_ID]: "none",
  [AV_GOOGLE_CREDENTIAL_TYPE_ID]: "none",
};

/** Inserts an age-credential row; type, state and createdAt are what vary. */
function insertAv(
  db: Db,
  id: string,
  state: "offered" | "active" | "failed",
  createdAt: number,
  userId = "user_anna",
  credentialTypeId: AgeCredentialTypeId = AV_CREDENTIAL_TYPE_ID,
) {
  db.insert(credentials)
    .values({
      id,
      userId,
      cardId: null,
      credentialTypeId,
      credentialId: null,
      state,
      issuedAt: state === "active" ? createdAt : null,
      createdAt,
    })
    .run();
}

describe("getAgeCredentialState", () => {
  it("reports 'none' when the user has no age credential", () => {
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
      formats: NO_AGE_FORMATS,
    });
  });

  it("reports 'offered' for an open offer", () => {
    insertAv(db, "av_1", "offered", 10);
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "offered",
      credentialRowId: "av_1",
      formats: { ...NO_AGE_FORMATS, [AV_CREDENTIAL_TYPE_ID]: "offered" },
    });
  });

  it("reports 'active' once the credential is issued", () => {
    insertAv(db, "av_1", "active", 10);
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "active",
      credentialRowId: "av_1",
      formats: { ...NO_AGE_FORMATS, [AV_CREDENTIAL_TYPE_ID]: "active" },
    });
  });

  // Same correction as listCards, for the same reason: an abandoned re-issue
  // must not make an issued age credential look absent.
  it("does not let a newer offer mask a credential already in the wallet", () => {
    insertAv(db, "av_old", "active", 10);
    insertAv(db, "av_new", "offered", 20);
    expect(getAgeCredentialState(db, "user_anna").state).toBe("active");
    expect(getAgeCredentialState(db, "user_anna").credentialRowId).toBe(
      "av_old",
    );
  });

  it("prefers the newest row within one state, so a re-issue does supersede", () => {
    insertAv(db, "av_first", "active", 10);
    insertAv(db, "av_second", "active", 20);
    expect(getAgeCredentialState(db, "user_anna").credentialRowId).toBe(
      "av_second",
    );
  });

  it("ignores failed rows", () => {
    insertAv(db, "av_failed", "failed", 30);
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
      formats: NO_AGE_FORMATS,
    });
  });

  it("ignores payment credentials, however active they are", () => {
    db.insert(credentials)
      .values({
        id: "cred_dpc",
        userId: "user_anna",
        cardId: "card_anna",
        credentialId: "dpc_active_1",
        state: "active",
        issuedAt: 1,
        createdAt: 99,
      })
      .run();
    expect(getAgeCredentialState(db, "user_anna")).toEqual({
      state: "none",
      credentialRowId: null,
      formats: NO_AGE_FORMATS,
    });
  });

  it("never reports another user's age credential", () => {
    insertAv(db, "av_ben", "active", 10, "user_ben");
    expect(getAgeCredentialState(db, "user_anna").state).toBe("none");
    expect(getAgeCredentialState(db, "user_ben").state).toBe("active");
  });
});

describe("getAgeCredentialState per format", () => {
  it("reports 'none' for both formats when nothing has been issued", () => {
    expect(getAgeCredentialState(db, "user_anna").formats).toEqual(
      NO_AGE_FORMATS,
    );
  });

  it("does not report the other format as issued when one is", () => {
    // The whole reason this field exists: the tile's two buttons must not claim
    // credit for each other's work.
    insertAv(db, "av_eudi", "active", 10, "user_anna", AV_CREDENTIAL_TYPE_ID);
    expect(getAgeCredentialState(db, "user_anna").formats).toEqual({
      ...NO_AGE_FORMATS,
      [AV_CREDENTIAL_TYPE_ID]: "active",
    });
  });

  it("resolves the Google Wallet format, which used to read as 'none'", () => {
    // A bare `av` row was ignored entirely until this format became live, so a
    // pre-existing one now correctly reads as in-wallet in the Google format.
    insertAv(
      db,
      "av_google",
      "active",
      10,
      "user_anna",
      AV_GOOGLE_CREDENTIAL_TYPE_ID,
    );
    const dto = getAgeCredentialState(db, "user_anna");
    expect(dto.formats).toEqual({
      ...NO_AGE_FORMATS,
      [AV_GOOGLE_CREDENTIAL_TYPE_ID]: "active",
    });
    expect(dto.state).toBe("active");
  });

  it("reports both when the credential is in a wallet twice", () => {
    insertAv(db, "av_eudi", "active", 10, "user_anna", AV_CREDENTIAL_TYPE_ID);
    insertAv(
      db,
      "av_google",
      "offered",
      20,
      "user_anna",
      AV_GOOGLE_CREDENTIAL_TYPE_ID,
    );
    expect(getAgeCredentialState(db, "user_anna").formats).toEqual({
      [AV_CREDENTIAL_TYPE_ID]: "active",
      [AV_GOOGLE_CREDENTIAL_TYPE_ID]: "offered",
    });
  });

  it("applies 'active outranks offered' within a format, not across formats", () => {
    // A newer abandoned EUDI offer must not demote the EUDI format's own active
    // row, and must not touch the Google format's answer at all.
    insertAv(db, "av_e_live", "active", 10, "user_anna", AV_CREDENTIAL_TYPE_ID);
    insertAv(
      db,
      "av_e_open",
      "offered",
      30,
      "user_anna",
      AV_CREDENTIAL_TYPE_ID,
    );
    insertAv(
      db,
      "av_g_open",
      "offered",
      20,
      "user_anna",
      AV_GOOGLE_CREDENTIAL_TYPE_ID,
    );
    expect(getAgeCredentialState(db, "user_anna").formats).toEqual({
      [AV_CREDENTIAL_TYPE_ID]: "active",
      [AV_GOOGLE_CREDENTIAL_TYPE_ID]: "offered",
    });
  });

  it("keys the record by exactly the two age formats", () => {
    expect(
      Object.keys(getAgeCredentialState(db, "user_anna").formats).sort(),
    ).toEqual([...AGE_CREDENTIAL_TYPE_IDS].sort());
  });

  it("reports the combined state as live when either format is", () => {
    // The tile's badge and face describe the credential, not a format — it is
    // in a wallet, and the face has no opinion about which one.
    insertAv(
      db,
      "av_google",
      "offered",
      10,
      "user_anna",
      AV_GOOGLE_CREDENTIAL_TYPE_ID,
    );
    expect(getAgeCredentialState(db, "user_anna").state).toBe("offered");
  });

  it("never mixes another user's formats in", () => {
    insertAv(
      db,
      "av_ben",
      "active",
      10,
      "user_ben",
      AV_GOOGLE_CREDENTIAL_TYPE_ID,
    );
    expect(getAgeCredentialState(db, "user_anna").formats).toEqual(
      NO_AGE_FORMATS,
    );
  });
});
