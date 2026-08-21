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
  };
  dashboard: {
    greeting: (name: string) => string;
    cards: string;
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
