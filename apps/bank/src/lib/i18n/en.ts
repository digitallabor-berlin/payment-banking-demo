import type { Messages } from "./messages.js";

export const en: Messages = {
  meta: {
    description: "Online banking demo with EUDI Wallet",
  },
  nav: {
    overview: "Overview",
    transactions: "Transactions",
    signOut: "Sign out",
    menu: "Menu",
    toOverview: "To overview",
    language: "Language",
  },
  login: {
    tagline: "Your reliable partner",
    walletFooter: "Payments via EUDI Wallet",
    username: "Username",
    password: "Password",
    submit: "Sign in",
    submitPending: "Signing in…",
    demoLogins: "Demo logins",
    failed: "Sign-in failed. Please check your credentials.",
    walletSubmit: "Sign in with wallet",
    walletDivider: "or",
  },
  walletLogin: {
    title: "Sign in with your wallet",
    preparing: "Preparing…",
    approve: "Open wallet",
    confirmInApp: "Confirm the request in your wallet app.",
    openInWallet: "Open in wallet",
    scanCode: "Scan this code with the wallet app on your phone.",
    qrAlt: "QR code for the sign-in request",
    waiting: "Waiting for your wallet…",
    cancel: "Cancel",
    close: "Close",
    successTitle: "Signed in",
    successBody: "Taking you to your accounts.",
    failedTitle: "Sign-in failed",
    expired: "The request expired. Please try again.",
    unknownCredential:
      "This credential is valid, but we cannot match it to a customer. Add the Sparkassen Authenticator to your wallet again from your overview, then try once more.",
    verificationFailed: "Your wallet's response could not be verified.",
  },
  dashboard: {
    greeting: (name) => `Good day, ${name}`,
    payments: "Payments",
    credentials: "Credentials",
    recentTransactions: "Recent transactions",
    showAll: "Show all",
  },
  transactions: {
    title: "Transactions",
    page: (page) => `Page ${page}`,
    empty: "No transactions.",
    emptyMore: "No further transactions.",
    pagination: "Pagination",
    newer: "← Newer",
    older: "Older →",
  },
  account: {
    type: "Current account",
    available: "Available balance",
  },
  credential: {
    ageTitle: "Age verification",
  },
  issuance: {
    // Names no scheme, exactly as the dialog and tile copy do not. The button
    // beside this one on the card and age tiles IS Google-branded, but that is
    // Google's artwork naming itself, not this app naming a wallet.
    addToWallet: "Add to wallet",
    addAgain: "Add to wallet again",
    // The accessible name for the Google Wallet badge. The badge is artwork
    // whose text is drawn as SVG paths, so nothing renders this string.
    addToGoogleWallet: "Add to Google Wallet",
    preparing: "Preparing…",
    confirmInApp: "Confirm the offer in your wallet app.",
    openInWallet: "Open in wallet",
    scanCode: "Scan the code with your wallet app.",
    qrAlt: "QR code for the credential offer",
    waiting: "Waiting for wallet",
    cancel: "Cancel",
    close: "Close",
    failedTitle: "Failed",
  },
  proof: {
    title: "Payment proof",
    open: "Show payment proof",
    // The bank stores this package; it verifies nothing in it (design D4).
    disclaimer:
      "Stored exactly as the merchant sent it. The bank has not checked it.",
    signedRequest: "Signed request",
    vpToken: "Wallet response",
    showRaw: "Show raw",
    showDecoded: "Show decoded",
    copy: "Copy",
    copied: "Copied",
    close: "Close",
    loading: "Loading…",
    loadFailed: "The proof could not be loaded.",
    undecodable: "Could not be decoded — shown as received.",
    credential: "Credential",
    header: "Header",
    payload: "Payload",
    signature: "Signature",
    disclosures: "Disclosures",
    keyBinding: "Key binding",
  },
  errors: {
    offerNotCreated: "The offer could not be created.",
    connectionFailed: "Connection to the server failed.",
    expired: "The request has expired. Please try again.",
    connectionLost: "Lost connection to the server.",
    dcApiUnsupported:
      "This browser does not support the Digital Credentials API.",
    dcApiCancelled: "The wallet handover was cancelled.",
  },
};
