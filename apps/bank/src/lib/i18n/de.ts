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
  },
  dashboard: {
    greeting: (name) => `Guten Tag, ${name}`,
    cards: "Karten",
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
  credential: {
    ageTitle: "Altersnachweis",
  },
  issuance: {
    addToWallet: "Zum EUDI Wallet hinzufügen",
    preparing: "Wird vorbereitet…",
    confirmInApp: "Bestätigen Sie das Angebot in Ihrer EUDI Wallet App.",
    openInWallet: "Im Wallet öffnen",
    scanCode: "Scannen Sie den Code mit Ihrer EUDI Wallet App.",
    qrAlt: "QR-Code für das Credential-Angebot",
    waiting: "Warte auf Wallet",
    cancel: "Abbrechen",
    close: "Schließen",
    failedTitle: "Fehlgeschlagen",
  },
  errors: {
    offerNotCreated: "Angebot konnte nicht erstellt werden.",
    connectionFailed: "Verbindung zum Server fehlgeschlagen.",
    expired: "Die Anfrage ist abgelaufen. Bitte erneut versuchen.",
    connectionLost: "Verbindung zum Server verloren.",
    dcApiUnsupported: "Dieser Browser unterstützt die Digital Credentials API nicht.",
    dcApiCancelled: "Die Übergabe an die Wallet wurde abgebrochen.",
  },
};