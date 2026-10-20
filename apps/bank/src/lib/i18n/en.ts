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
    profile: "Your details",
    recentTransactions: "Recent transactions",
    showAll: "Show all",
  },
  profile: {
    username: "Username",
    mobileNumber: "Mobile number",
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
  limits: {
    dailyTransfer: "Daily transfer limit",
    change: "Change",
    dialogTitle: "Change your daily transfer limit",
    dialogLead:
      "Pick a new limit. You will confirm the change in your wallet before it takes effect.",
    currentLimit: "Current limit",
    newLimit: "New limit",
    continue: "Continue",
    cancel: "Cancel",
    close: "Close",
    approveTitle: "Confirm in your wallet",
    confirmInApp: "Confirm the change in your wallet app.",
    openInWallet: "Open in wallet",
    scanCode: "Scan this code with the wallet app on your phone.",
    qrAlt: "QR code for the limit change request",
    waiting: "Waiting for your wallet…",
    preparing: "Preparing…",
    walletUnavailable:
      "Your wallet did not respond. You can scan a code with the wallet app on your phone instead.",
    showQrCode: "Show QR code",
    successTitle: "Limit changed",
    successBody: (limit) => `Your daily transfer limit is now ${limit}.`,
    failedTitle: "Limit not changed",
    expired: "The request expired. Please try again.",
    unknownCredential:
      "This credential is valid, but we cannot match it to a customer. Add the Sparkassen Authenticator to your wallet again from your overview, then try once more.",
    limitChanged:
      "Your limit changed while we were waiting for your wallet, so this approval no longer matches. Please start again.",
    verificationFailed:
      "Your wallet's response could not be verified. Your limit is unchanged.",
  },
  transfers: {
    sendMoney: "Send money",
    dialogTitle: "Send money",
    dialogLead:
      "Enter the recipient and the amount. You will approve the transfer in your wallet before any money leaves your account.",
    recipientName: "Recipient name",
    recipientIban: "Recipient IBAN",
    amount: "Amount",
    purpose: "Purpose",
    send: "Send",
    cancel: "Cancel",
    close: "Close",
    invalidName: "Enter the recipient's name.",
    invalidIban: "Check the IBAN — it does not look right.",
    invalidAmount: "Enter an amount, for example 250.00.",
    invalidPurpose: "Enter what this transfer is for.",
    approveTitle: "Approve in your wallet",
    confirmInApp: "Approve the transfer in your wallet app.",
    openInWallet: "Open in wallet",
    scanCode: "Scan this code with the wallet app on your phone.",
    qrAlt: "QR code for the transfer request",
    waiting: "Waiting for your wallet…",
    preparing: "Preparing…",
    walletUnavailable:
      "Your wallet did not respond. You can scan a code with the wallet app on your phone instead.",
    showQrCode: "Show QR code",
    successTitle: "Money sent",
    successBody: (amount, payee) => `${amount} is on its way to ${payee}.`,
    failedTitle: "Money not sent",
    expired: "The request expired. Please try again.",
    unknownCredential:
      "This credential is valid, but we cannot match it to a customer. Add the Sparkassen Authenticator to your wallet again from your overview, then try once more.",
    limitExceeded:
      "This transfer is above your daily transfer limit. Send a smaller amount, or raise your limit first.",
    insufficientFunds:
      "There is not enough money in the account for this transfer. Nothing has been sent.",
    verificationFailed:
      "Your wallet's response could not be verified. No money has been sent.",
  },
  phones: {
    change: "Change",
    dialogTitle: "Change your mobile number",
    dialogLead:
      "Enter your new mobile number. You will confirm the change in your wallet before it takes effect.",
    mobileNumber: "New mobile number",
    hint: "In international format, for example +49 171 5555555.",
    continue: "Continue",
    cancel: "Cancel",
    close: "Close",
    approveTitle: "Confirm in your wallet",
    confirmInApp: "Confirm the new number in your wallet app.",
    openInWallet: "Open in wallet",
    scanCode: "Scan this code with the wallet app on your phone.",
    qrAlt: "QR code for the mobile number change request",
    waiting: "Waiting for your wallet…",
    preparing: "Preparing…",
    walletUnavailable:
      "Your wallet did not respond. You can scan a code with the wallet app on your phone instead.",
    showQrCode: "Show QR code",
    successTitle: "Mobile number changed",
    successBody: (phoneNumber) =>
      `We will reach you on ${phoneNumber} from now on.`,
    failedTitle: "Mobile number not changed",
    expired: "The request expired. Please try again.",
    unknownCredential:
      "This credential is valid, but we cannot match it to a customer. Add the Sparkassen Authenticator to your wallet again from your overview, then try once more.",
    phoneChanged:
      "Your mobile number changed while we were waiting for your wallet, so this approval no longer matches. Please start again.",
    invalidPhone:
      "That does not look like a mobile number. Use the international format, for example +49 171 5555555.",
    phoneUnchanged: "That is already your mobile number.",
    verificationFailed:
      "Your wallet's response could not be verified. Your mobile number is unchanged.",
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
    unverifiedMark: "Unverified",
    signedRequest: "Signed request",
    vpToken: "Wallet response",
    decoded: "Decoded",
    raw: "Raw",
    received: "Received",
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
