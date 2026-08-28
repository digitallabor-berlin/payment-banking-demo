import type { Locale } from "./locale.js";
import { en } from "./en.js";
import { de } from "./de.js";

/**
 * Every user-facing string the bank renders, except the copy that varies by
 * credential type (see `credential-copy.ts`) and the proper nouns listed in the
 * plan's Global Constraints.
 *
 * Both catalogs are declared against this one interface, so a missing or
 * misspelled key is a COMPILE error rather than a runtime `undefined` that
 * renders as an empty node.
 *
 * Interpolated entries are functions, not `"{name}"` placeholders: there are
 * only two of them in the whole app, and a function gets its arity and
 * parameter types checked. The consequence is that a catalog entry is not
 * serialisable, which is why components receive `locale` and index the catalog
 * themselves rather than being handed resolved copy.
 */
export interface Messages {
 meta: {
  description: string;
 };
 nav: {
  overview: string;
  transactions: string;
  signOut: string;
  menu: string;
  /** aria-label on the logo link. */
  toOverview: string;
  /** aria-label on the language switcher group. */
  language: string;
 };
 login: {
  tagline: string;
  walletFooter: string;
  username: string;
  password: string;
  submit: string;
  submitPending: string;
  demoLogins: string;
  failed: string;
  /** The wallet button on the login screen. */
  walletSubmit: string;
  /** Separates the password form from the wallet button. */
  walletDivider: string;
 };
 /**
  * The wallet-login dialog.
  *
  * A block of its own rather than more keys under `login`, because it is a
  * modal with its own lifecycle rather than more of the login form — the
  * same reason `issuance` is separate from `credential`.
  *
  * The three failure strings are keyed by the `failure_reason` values
  * `login-sessions.ts` writes, so a new reason there is a compile error
  * here rather than a dialog that renders nothing.
  */
 walletLogin: {
  title: string;
  /** While DC API detection is unresolved. NOT the QR fallback. */
  preparing: string;
  approve: string;
  confirmInApp: string;
  openInWallet: string;
  scanCode: string;
  qrAlt: string;
  waiting: string;
  cancel: string;
  close: string;
  successTitle: string;
  successBody: string;
  failedTitle: string;
  /** failure_reason `expired` */
  expired: string;
  /**
   * failure_reason `unknown_credential` — a real, correctly-signed
   * credential this bank cannot match to a customer. The commonest
   * cause is a credential issued before the subject was persisted, so
   * this copy must name the remedy: add it to the wallet again.
   */
  unknownCredential: string;
  /** failure_reason `verification_failed` and `foundry_unavailable` */
  verificationFailed: string;
 };
 dashboard: {
  greeting: (name: string) => string;
  /**
   * The heading over the payment instruments. Named for what they do rather
   * than what they are: the girocard is a card, Wero is drawn on the
   * account itself, and one heading has to cover both.
   */
  payments: string;
  credentials: string;
  recentTransactions: string;
  showAll: string;
 };
 transactions: {
  title: string;
  page: (page: number) => string;
  empty: string;
  emptyMore: string;
  /** aria-label on the pagination nav. */
  pagination: string;
  newer: string;
  older: string;
 };
 account: {
  type: string;
  available: string;
 };
 credential: {
  ageTitle: string;
 };
 issuance: {
  addToWallet: string;
  /**
   * The same button once the credential is already in the wallet. A
   * separate key rather than a suffix: nothing forbids a second issuance
   * (the server has no "already active" guard and the newest non-failed
   * row wins), so the button stays live and has to say so.
   */
  addAgain: string;
  /**
   * The accessible name for the Google Wallet badge.
   *
   * Unlike every other entry here, nothing renders this string: the badge is
   * Google's artwork and its text is drawn as SVG paths, so this is the
   * button's `aria-label` and the image's `alt` and nothing else. It is
   * catalogued rather than hardcoded because a screen reader in German
   * should not be read an English name.
   */
  addToGoogleWallet: string;
  preparing: string;
  confirmInApp: string;
  openInWallet: string;
  scanCode: string;
  qrAlt: string;
  waiting: string;
  cancel: string;
  close: string;
  failedTitle: string;
 };
 /**
  * The PaSO proof package viewer.
  *
  * NOTHING here may claim the bank verified this package. It stores what
  * the merchant forwarded and runs none of PaSO §3's checks (design D4), so
  * `disclaimer` says so in as many words and no other string implies
  * otherwise. "Proof" here names the artefact, not a verdict.
  */
 proof: {
  /** Dialog title. */
  title: string;
  /** Accessible name of the ledger-row button. */
  open: string;
  /** States plainly that the bank stored this and did not check it. */
  disclaimer: string;
  /**
   * The custody strip's one-word mark, set beside `disclaimer`.
   *
   * Names the STATE, not the artefact: the single fact a reader must
   * not skim past is that nothing here was checked. It reads as a
   * neutral custody label rather than an alarm because the sentence
   * beside it says what was actually done.
   */
  unverifiedMark: string;
  /** Label for the `signed_request` member. */
  signedRequest: string;
  /** Label for the `vp_token` member. */
  vpToken: string;
  /**
   * The two options of the view control.
   *
   * STATE labels, not commands — "Decoded", never "Show decoded". The
   * control is a segmented pair showing both options at once, so each
   * label names what you are looking at rather than what clicking does.
   */
  decoded: string;
  raw: string;
  /** Labels the moment the bank received the package. */
  received: string;
  copy: string;
  copied: string;
  close: string;
  loading: string;
  loadFailed: string;
  /** Shown beside an artefact the decoder could not read. */
  undecodable: string;
  credential: string;
  header: string;
  payload: string;
  signature: string;
  disclosures: string;
  keyBinding: string;
 };
 errors: {
  offerNotCreated: string;
  connectionFailed: string;
  expired: string;
  connectionLost: string;
  dcApiUnsupported: string;
  dcApiCancelled: string;
 };
}

export const MESSAGES: Record<Locale, Messages> = { en, de };

/**
 * Leaf paths that are permitted to be byte-identical across locales.
 *
 * Empty today: every proper noun (Sparkasse, Musterstadt, IBAN, EUDI Wallet)
 * is hardcoded in its component rather than catalogued, precisely so this list
 * can stay empty and the distinctness check in `messages.test.ts` can be
 * absolute. Add a path here only with a comment saying why the two languages
 * genuinely agree.
 */
export const IDENTICAL_BY_DESIGN: readonly string[] = [];
