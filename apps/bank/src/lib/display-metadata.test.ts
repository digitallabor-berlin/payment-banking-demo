import { describe, expect, it } from "vitest";
import {
  buildCredentialResponseDisplay,
  buildOfferDisplay,
  cardArtUrl,
  GIROCARD_LOGO_URL,
  ibanLastFour,
  SPARKASSE_LOGO_URL,
} from "./display-metadata.js";

const annaCard = { network: "girocard", cardAlias: "Girocard" };

describe("ibanLastFour", () => {
  it("returns the last four digits of a seeded IBAN", () => {
    expect(ibanLastFour("DE02120300000000202051")).toBe("2051");
    expect(ibanLastFour("DE02500105170137075030")).toBe("5030");
  });

  it("ignores the grouping spaces of a human-formatted IBAN", () => {
    expect(ibanLastFour("DE02 1203 0000 0000 2020 51")).toBe("2051");
  });

  it("throws when the tail is not four digits, rather than sending a value foundry rejects", () => {
    // foundry enforces `^[0-9]{4}$` and 400s the WHOLE offer, so a bad tail must
    // fail here — where the message names the IBAN — not there.
    expect(() => ibanLastFour("DE0212030000000020AB")).toThrow(/four/i);
  });

  it("throws on an IBAN too short to have four trailing digits", () => {
    expect(() => ibanLastFour("123")).toThrow(/four/i);
  });
});

describe("cardArtUrl", () => {
  it("points at the bank's own artwork on its public origin", () => {
    expect(cardArtUrl("https://sparkasse-musterstadt.digitallabor.dev")).toBe(
      "https://sparkasse-musterstadt.digitallabor.dev/card-face.webp",
    );
  });

  it("does not double the slash when the base URL already ends in one", () => {
    expect(cardArtUrl("http://localhost:3001/")).toBe(
      "http://localhost:3001/card-face.webp",
    );
  });
});

describe("buildOfferDisplay", () => {
  const display = buildOfferDisplay(annaCard);

  it("returns exactly one entry, since foundry allows one object per locale", () => {
    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({ locale: "en-US" });
  });

  it("carries the Sparkasse wordmark, palette and logo at the top level", () => {
    expect(display[0]).toMatchObject({
      name: "Sparkassen Card",
      background_color: "#EA0016",
      text_color: "#FFFFFF",
      logo: { uri: SPARKASSE_LOGO_URL },
    });
  });

  it("declares a DEBIT card type labelled for the product", () => {
    const card = (display[0] as { card: Record<string, unknown> }).card;
    expect(card.type).toEqual({ code: "DEBIT", label: "Sparkassen Card" });
  });

  it("omits last_four, alias and card_art — the offer stage must carry no PII", () => {
    const card = (display[0] as { card: Record<string, unknown> }).card;
    expect(card).not.toHaveProperty("last_four");
    expect(card).not.toHaveProperty("alias");
    expect(card).not.toHaveProperty("card_art");
  });

  it("names the issuer with a two-letter country and contact details", () => {
    const card = (display[0] as { card: Record<string, unknown> }).card;
    expect(card.issuer).toEqual({
      branding: {
        name: "Sparkasse Musterstadt",
        logo: [{ theme: "DEFAULT", image_url: SPARKASSE_LOGO_URL }],
      },
      country: "DE",
      website_url: "https://digitallabor.berlin",
      support_email: "support@digitallabor.berlin",
    });
  });

  it("derives network_branding from the card's own network", () => {
    const card = (display[0] as { card: Record<string, unknown> }).card;
    expect(card.network_branding).toEqual([
      {
        network: "girocard",
        branding: {
          name: "girocard",
          logo: [{ theme: "DEFAULT", image_url: GIROCARD_LOGO_URL }],
        },
      },
    ]);
  });

  it("falls back to the bare network name when no branding asset is known", () => {
    const display = buildOfferDisplay({
      network: "Mastercard",
      cardAlias: "Kreditkarte",
    });
    const card = (display[0] as { card: Record<string, unknown> }).card;
    // `branding.name` must stay non-empty or foundry rejects the offer; a logo
    // is optional, so an unknown network degrades to a name-only branding.
    expect(card.network_branding).toEqual([
      { network: "Mastercard", branding: { name: "Mastercard" } },
    ]);
  });
});

describe("buildCredentialResponseDisplay", () => {
  const display = buildCredentialResponseDisplay({
    card: annaCard,
    iban: "DE02120300000000202051",
    cardArtUrl: "https://bank.test/card-face.webp",
  });
  const card = (display[0] as { card: Record<string, unknown> }).card;

  it("returns exactly one entry for the same locale as the offer", () => {
    expect(display).toHaveLength(1);
    expect(display[0]).toMatchObject({ locale: "en-US" });
  });

  it("derives last_four from the IBAN", () => {
    expect(card.last_four).toBe("2051");
  });

  it("uses the card's own alias rather than a hardcoded product name", () => {
    expect(card.alias).toBe("Girocard");
  });

  it("points card_art at the supplied URL", () => {
    expect(card.card_art).toEqual([
      { theme: "DEFAULT", image_url: "https://bank.test/card-face.webp" },
    ]);
  });

  it("keeps every member the offer stage already carried", () => {
    expect(card.type).toEqual({ code: "DEBIT", label: "Sparkassen Card" });
    expect(card).toHaveProperty("issuer");
    expect(card).toHaveProperty("network_branding");
    expect(display[0]).toMatchObject({
      name: "Sparkassen Card",
      text_color: "#FFFFFF",
    });
  });

  it("propagates a bad IBAN as a throw rather than an offer foundry would reject", () => {
    expect(() =>
      buildCredentialResponseDisplay({
        card: annaCard,
        iban: "DE00000000000000000ABC",
        cardArtUrl: "https://bank.test/card-face.webp",
      }),
    ).toThrow(/four/i);
  });
});
