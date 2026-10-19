import type { Messages } from "./messages.js";

export const de: Messages = {
  meta: {
    description: "Online-Banking Demo mit EUDI Wallet",
  },
  nav: {
    overview: "Übersicht",
    transactions: "Umsätze",
    signOut: "Abmelden",
    menu: "Menü",
    toOverview: "Zur Übersicht",
    language: "Sprache",
  },
  login: {
    tagline: "Ihr verlässlicher Partner",
    walletFooter: "Zahlungen über EUDI Wallet",
    username: "Anmeldename",
    password: "Passwort",
    submit: "Anmelden",
    submitPending: "Wird angemeldet…",
    demoLogins: "Demo-Zugänge",
    failed: "Anmeldung fehlgeschlagen. Bitte Zugangsdaten prüfen.",
    // Deliberately article-less. The catalog is split on the gender of
    // "Wallet" — `walletLogin` below treats it as feminine ("Mit Ihrer
    // Wallet"), `issuance` as neuter ("Zum Wallet") — and this string sits
    // between the two, so it takes no article and picks no side.
    walletSubmit: "Mit Wallet anmelden",
    walletDivider: "oder",
  },
  walletLogin: {
    title: "Mit Ihrer Wallet anmelden",
    preparing: "Wird vorbereitet…",
    approve: "Wallet öffnen",
    confirmInApp: "Bestätigen Sie die Anfrage in Ihrer Wallet-App.",
    openInWallet: "In Wallet öffnen",
    scanCode: "Scannen Sie diesen Code mit der Wallet-App auf Ihrem Telefon.",
    qrAlt: "QR-Code für die Anmeldeanfrage",
    waiting: "Warten auf Ihre Wallet…",
    cancel: "Abbrechen",
    close: "Schließen",
    successTitle: "Angemeldet",
    successBody: "Sie werden zu Ihren Konten weitergeleitet.",
    failedTitle: "Anmeldung fehlgeschlagen",
    expired: "Die Anfrage ist abgelaufen. Bitte versuchen Sie es erneut.",
    unknownCredential:
      "Dieser Nachweis ist gültig, kann aber keinem Kunden zugeordnet werden. Fügen Sie den Sparkassen Authenticator über Ihre Übersicht erneut zur Wallet hinzu und versuchen Sie es dann noch einmal.",
    verificationFailed: "Die Antwort Ihrer Wallet konnte nicht geprüft werden.",
  },
  dashboard: {
    greeting: (name) => `Guten Tag, ${name}`,
    payments: "Zahlungsmittel",
    credentials: "Nachweise",
    recentTransactions: "Letzte Umsätze",
    showAll: "Alle anzeigen",
  },
  transactions: {
    title: "Umsätze",
    page: (page) => `Seite ${page}`,
    empty: "Keine Umsätze vorhanden.",
    emptyMore: "Keine weiteren Umsätze.",
    pagination: "Seitennavigation",
    newer: "← Neuer",
    older: "Älter →",
  },
  account: {
    type: "Girokonto",
    available: "Verfügbarer Betrag",
  },
  limits: {
    dailyTransfer: "Tägliches Überweisungslimit",
    change: "Ändern",
    dialogTitle: "Tägliches Überweisungslimit ändern",
    dialogLead:
      "Wählen Sie ein neues Limit. Sie bestätigen die Änderung in Ihrer Wallet, bevor sie wirksam wird.",
    currentLimit: "Aktuelles Limit",
    newLimit: "Neues Limit",
    continue: "Weiter",
    cancel: "Abbrechen",
    close: "Schließen",
    approveTitle: "In Ihrer Wallet bestätigen",
    confirmInApp: "Bestätigen Sie die Änderung in Ihrer Wallet-App.",
    openInWallet: "In Wallet öffnen",
    scanCode: "Scannen Sie diesen Code mit der Wallet-App auf Ihrem Telefon.",
    qrAlt: "QR-Code für die Limitänderung",
    waiting: "Warten auf Ihre Wallet…",
    preparing: "Wird vorbereitet…",
    successTitle: "Limit geändert",
    successBody: (limit) =>
      `Ihr tägliches Überweisungslimit beträgt jetzt ${limit}.`,
    failedTitle: "Limit nicht geändert",
    expired: "Die Anfrage ist abgelaufen. Bitte versuchen Sie es erneut.",
    unknownCredential:
      "Dieser Nachweis ist gültig, kann aber keinem Kunden zugeordnet werden. Fügen Sie den Sparkassen Authenticator über Ihre Übersicht erneut zur Wallet hinzu und versuchen Sie es dann noch einmal.",
    limitChanged:
      "Ihr Limit hat sich geändert, während wir auf Ihre Wallet gewartet haben. Diese Bestätigung passt deshalb nicht mehr. Bitte beginnen Sie erneut.",
    verificationFailed:
      "Die Antwort Ihrer Wallet konnte nicht geprüft werden. Ihr Limit bleibt unverändert.",
  },
  credential: {
    ageTitle: "Altersnachweis",
  },
  issuance: {
    addToWallet: "Zum Wallet hinzufügen",
    addAgain: "Erneut zum Wallet hinzufügen",
    addToGoogleWallet: "Zu Google Wallet hinzufügen",
    preparing: "Wird vorbereitet…",
    // "Wallet-App" hyphenated: with "EUDI" gone the two nouns form a German
    // compound, which "EUDI Wallet App" was spared only by the proper noun in
    // front of it. Matches the spelling `walletLogin` already uses.
    confirmInApp: "Bestätigen Sie das Angebot in Ihrer Wallet-App.",
    openInWallet: "Im Wallet öffnen",
    scanCode: "Scannen Sie den Code mit Ihrer Wallet-App.",
    qrAlt: "QR-Code für das Credential-Angebot",
    waiting: "Warte auf Wallet",
    cancel: "Abbrechen",
    close: "Schließen",
    failedTitle: "Fehlgeschlagen",
  },
  proof: {
    title: "Zahlungsnachweis",
    open: "Zahlungsnachweis anzeigen",
    disclaimer:
      "Unverändert so gespeichert, wie der Händler ihn gesendet hat. Die Bank hat ihn nicht geprüft.",
    unverifiedMark: "Ungeprüft",
    signedRequest: "Signierte Anfrage",
    vpToken: "Wallet-Antwort",
    decoded: "Dekodiert",
    raw: "Rohdaten",
    received: "Empfangen",
    copy: "Kopieren",
    copied: "Kopiert",
    close: "Schließen",
    loading: "Wird geladen…",
    loadFailed: "Der Nachweis konnte nicht geladen werden.",
    undecodable: "Konnte nicht dekodiert werden — Anzeige wie empfangen.",
    credential: "Nachweis",
    // NOT "Header". `messages.test.ts` fails any leaf that is byte-identical
    // across the two locales, and this is the one word in this block where the
    // English is also idiomatic German.
    header: "Kopfdaten",
    payload: "Nutzdaten",
    signature: "Signatur",
    disclosures: "Offengelegte Angaben",
    keyBinding: "Schlüsselbindung",
  },
  errors: {
    offerNotCreated: "Angebot konnte nicht erstellt werden.",
    connectionFailed: "Verbindung zum Server fehlgeschlagen.",
    expired: "Die Anfrage ist abgelaufen. Bitte erneut versuchen.",
    connectionLost: "Verbindung zum Server verloren.",
    dcApiUnsupported:
      "Dieser Browser unterstützt die Digital Credentials API nicht.",
    dcApiCancelled: "Die Übergabe an die Wallet wurde abgebrochen.",
  },
};
