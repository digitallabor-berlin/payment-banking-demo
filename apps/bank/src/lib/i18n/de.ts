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
    profile: "Ihre Daten",
    recentTransactions: "Letzte Umsätze",
    showAll: "Alle anzeigen",
  },
  profile: {
    username: "Benutzername",
    mobileNumber: "Mobilnummer",
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
    walletUnavailable:
      "Ihre Wallet hat nicht geantwortet. Sie können stattdessen einen Code mit der Wallet-App auf Ihrem Telefon scannen.",
    showQrCode: "QR-Code anzeigen",
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
  transfers: {
    sendMoney: "Geld senden",
    dialogTitle: "Geld senden",
    dialogLead:
      "Geben Sie Empfänger und Betrag ein. Sie geben die Überweisung in Ihrer Wallet frei, bevor Geld Ihr Konto verlässt.",
    recipientName: "Name des Empfängers",
    recipientIban: "IBAN des Empfängers",
    amount: "Betrag",
    purpose: "Verwendungszweck",
    send: "Senden",
    cancel: "Abbrechen",
    close: "Schließen",
    invalidName: "Geben Sie den Namen des Empfängers ein.",
    invalidIban: "Prüfen Sie die IBAN – sie scheint nicht zu stimmen.",
    invalidAmount: "Geben Sie einen Betrag ein, zum Beispiel 250,00.",
    invalidPurpose: "Geben Sie an, wofür diese Überweisung bestimmt ist.",
    approveTitle: "In Ihrer Wallet freigeben",
    confirmInApp: "Geben Sie die Überweisung in Ihrer Wallet-App frei.",
    openInWallet: "In Wallet öffnen",
    scanCode: "Scannen Sie diesen Code mit der Wallet-App auf Ihrem Telefon.",
    qrAlt: "QR-Code für die Überweisung",
    waiting: "Warten auf Ihre Wallet…",
    preparing: "Wird vorbereitet…",
    walletUnavailable:
      "Ihre Wallet hat nicht geantwortet. Sie können stattdessen einen Code mit der Wallet-App auf Ihrem Telefon scannen.",
    showQrCode: "QR-Code anzeigen",
    successTitle: "Geld gesendet",
    successBody: (amount, payee) => `${amount} ist unterwegs an ${payee}.`,
    failedTitle: "Geld nicht gesendet",
    expired: "Die Anfrage ist abgelaufen. Bitte versuchen Sie es erneut.",
    unknownCredential:
      "Dieser Nachweis ist gültig, kann aber keinem Kunden zugeordnet werden. Fügen Sie den Sparkassen Authenticator über Ihre Übersicht erneut zur Wallet hinzu und versuchen Sie es dann noch einmal.",
    limitExceeded:
      "Diese Überweisung liegt über Ihrem täglichen Überweisungslimit. Senden Sie einen kleineren Betrag oder erhöhen Sie zuerst Ihr Limit.",
    insufficientFunds:
      "Das Konto weist für diese Überweisung keine ausreichende Deckung auf. Es wurde nichts gesendet.",
    verificationFailed:
      "Die Antwort Ihrer Wallet konnte nicht geprüft werden. Es wurde kein Geld gesendet.",
  },
  phones: {
    change: "Ändern",
    dialogTitle: "Mobilnummer ändern",
    dialogLead:
      "Geben Sie Ihre neue Mobilnummer ein. Sie bestätigen die Änderung in Ihrer Wallet, bevor sie wirksam wird.",
    mobileNumber: "Neue Mobilnummer",
    hint: "Im internationalen Format, zum Beispiel +49 171 5555555.",
    continue: "Weiter",
    cancel: "Abbrechen",
    close: "Schließen",
    approveTitle: "In Ihrer Wallet bestätigen",
    confirmInApp: "Bestätigen Sie die neue Nummer in Ihrer Wallet-App.",
    openInWallet: "In Wallet öffnen",
    scanCode: "Scannen Sie diesen Code mit der Wallet-App auf Ihrem Smartphone.",
    qrAlt: "QR-Code für die Änderung der Mobilnummer",
    waiting: "Warten auf Ihre Wallet…",
    preparing: "Wird vorbereitet…",
    walletUnavailable:
      "Ihre Wallet hat nicht geantwortet. Sie können stattdessen einen Code mit der Wallet-App auf Ihrem Smartphone scannen.",
    showQrCode: "QR-Code anzeigen",
    successTitle: "Mobilnummer geändert",
    successBody: (phoneNumber) =>
      `Wir erreichen Sie ab sofort unter ${phoneNumber}.`,
    failedTitle: "Mobilnummer nicht geändert",
    expired: "Die Anfrage ist abgelaufen. Bitte versuchen Sie es erneut.",
    unknownCredential:
      "Dieser Nachweis ist gültig, kann aber keinem Kunden zugeordnet werden. Fügen Sie den Sparkassen Authenticator über Ihre Übersicht erneut zur Wallet hinzu und versuchen Sie es dann noch einmal.",
    phoneChanged:
      "Ihre Mobilnummer hat sich geändert, während wir auf Ihre Wallet gewartet haben. Diese Bestätigung passt nicht mehr. Bitte starten Sie erneut.",
    invalidPhone:
      "Das sieht nicht nach einer Mobilnummer aus. Bitte verwenden Sie das internationale Format, zum Beispiel +49 171 5555555.",
    phoneUnchanged: "Das ist bereits Ihre Mobilnummer.",
    verificationFailed:
      "Die Antwort Ihrer Wallet konnte nicht geprüft werden. Ihre Mobilnummer bleibt unverändert.",
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
