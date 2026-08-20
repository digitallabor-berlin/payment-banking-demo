# Bank app — English/German language support

Design spec. Written 2026-08-20.

## Problem

`apps/bank` is German-only. Every user-facing string is either a literal inside
JSX or an entry in `src/lib/credential-copy.ts`, and the four `Intl` instances in
`src/lib/format.ts` are module-scope singletons pinned to `de-DE`. There is no
locale concept anywhere in the app.

The demo is shown to audiences who do not read German. It needs an English
surface, with English as the default and German reachable in one click.

## Decisions taken

These were settled in brainstorming and are not open for reinterpretation
during implementation.

| Question | Decision |
| --- | --- |
| How the user picks a language | Explicit switcher, persisted in a cookie. **No `Accept-Language` detection.** |
| Default language | **English.** No cookie means English. German is opt-in. |
| Depth | UI chrome **and** locale-aware number/date formatting. Seeded data is not translated. |
| Wallet display metadata | **Untouched.** `display-metadata.ts` stays pinned to `locale: "en-US"`. |
| Mechanism | **Hand-rolled catalog**, no i18n dependency. |
| DC API diagnostic strings | **Folded into the catalog**, superseding the note in `apps/bank/AGENTS.md`. |

### Why no `Accept-Language`

A demo is driven from a laptop whose browser language is whatever the presenter
happens to have configured. Detection makes the starting language unpredictable
and the switch unprovable. An explicit control is the point.

### Why no library

`next-intl` is the idiomatic answer for a Next App Router project, and it was
rejected on three grounds specific to this repo:

1. The app has ~90 short static strings and no plurals, so ICU MessageFormat
   and per-route catalog splitting buy nothing.
2. `next-intl`'s well-trodden path wants middleware. Neither app in this repo
   has middleware, and this repo has documented scar tissue around Next's edge
   compilation (`next.config.ts` carries an `IgnorePlugin` specifically to stop
   the edge graph reaching `better-sqlite3`). Adding edge surface for a display
   preference is a poor trade.
3. Its runtime configuration lives outside `.ts` modules that this repo's
   vitest setup can cover. See "Testability constraint" below.

### Why the wallet credential does not follow the switch

`display-metadata.ts` builds what the EUDI wallet renders on the issued card.
foundry validates it all-or-nothing: any deviation is `400 invalid_request` and
the offer is never created, so a mistake surfaces as a `failed` issuance row,
not a cosmetic defect. foundry also permits only **one display object per
locale**, so following the switch would be a swap rather than an addition.

The wallet leg cannot be exercised in this environment — no device, no wallet
app. Shipping an untestable change to the one path where a malformed field
kills the whole offer is not worth a cosmetic gain. It stays `en-US`.

## Testability constraint

Every vitest project in this repo is `environment: "node"` with
`include: ["src/**/*.test.ts"]`. A `.tsx` file is never matched, and there is no
jsdom. **A decision made inside a component is therefore untestable.**

This is not incidental to the design; it is the reason the design looks the way
it does. Locale resolution, the catalogs, the copy accessors and the formatters
all live in `.ts` modules. Components consume them and contain no branching on
locale beyond indexing.

## Architecture

### New modules

```text
apps/bank/src/lib/i18n/
  locale.ts     Locale type, default, cookie name, resolveLocale()
  messages.ts   Messages interface + MESSAGES: Record<Locale, Messages>
  en.ts         English catalog
  de.ts         German catalog
  server.ts     getLocale() — reads the cookie via next/headers
```

`apps/bank/src/components/LocaleSwitcher.tsx` — the control.

### `locale.ts`

```ts
export type Locale = "en" | "de";
export const LOCALES = ["en", "de"] as const;
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "bank_locale";

export function resolveLocale(raw: string | undefined): Locale;
```

`resolveLocale` is pure and total. It trims surrounding whitespace and
lowercases, then returns `"de"` if and only if the normalised value is exactly
`"de"`. Everything else — `undefined`, `""`, `"fr"`, `"de-DE"`, or any junk
value — returns `DEFAULT_LOCALE`. It never throws.

Normalisation is deliberately shallow: `"DE"` and `" de "` resolve to German,
but `"de-DE"` does **not**. The cookie is written only by our own switcher,
which always writes a bare `"de"` or `"en"`, so a BCP-47-shaped value can only
be tampering or staleness, and falling back to the default is the safe answer.
No language-tag parsing is introduced for a two-locale closed union.

### `messages.ts`

```ts
export interface Messages { /* nested by area */ }
export const MESSAGES: Record<Locale, Messages> = { en, de };
```

Both catalogs are declared against one interface, so **a missing or misspelled
key is a compile error**, not a runtime `undefined` rendering as an empty node.

Nesting follows the UI: `nav`, `login`, `dashboard`, `transactions`, `account`,
`card`, `credential`, `issuance`, `errors`.

### Interpolation is functions, not placeholders

```ts
greeting: (name: string) => `Good day, ${name}`
```

rather than `"Good day, {name}"` plus a formatter. The app has exactly two
interpolated strings (`Guten Tag, {name}` and `Seite {page}`), and a function
gets its arity and parameter types checked by the compiler.

The consequence, stated so it is not discovered later: **a catalog entry cannot
be passed across the RSC boundary as a prop**, because functions are not
serialisable. That is fine because of the next decision.

### Client components receive `locale`, never copy

The six `"use client"` components — `LoginForm`, `CardTile`, `IssuanceDialog`,
`AppHeader`, `AddToWalletButton`, `AgeCredentialTile` — plus `LocaleSwitcher`
take a `locale: Locale` prop and index `MESSAGES` themselves, exactly as
`CardTile` today imports `STATE_COPY` directly. Only a two-character string
crosses the boundary.

The presentational server components that carry copy — `AuthCard`,
`AccountPanel`, `TransactionLedger`, `TransactionRow` — take the same
`locale: Locale` prop, for uniformity rather than necessity. One rule for the
whole component tree is easier to hold than "server components resolve, client
components receive".

Both catalogs ship in the client bundle. At ~90 short strings this is noise, and
it buys a much simpler data flow than resolving copy server-side and serialising
it.

### `server.ts`

```ts
export async function getLocale(): Promise<Locale> {
  return resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
}
```

Deliberately logic-free. `next/headers` cannot be exercised under
`environment: "node"`, so all behaviour lives in `resolveLocale`, which is fully
tested. This wrapper is a one-liner precisely so there is nothing in it to test.

Every page is already `export const dynamic = "force-dynamic"` and already
`await getSession()`, so adding `await getLocale()` beside it costs nothing.

## Existing modules that change

### `credential-copy.ts`

`FACE_COPY` and `DIALOG_COPY` gain `Locale` as the **outermost** key. The
exported surface changes from constants to accessors:

```ts
export function faceCopy(locale: Locale, typeId: CredentialTypeId, state: CardFaceState): CardFaceCopy;
export function dialogCopy(locale: Locale, typeId: CredentialTypeId): IssuanceCopy;
```

The module's existing rationale is unchanged and still applies: German
grammatical gender differs between "die Karte" and "der Altersnachweis", so a
`subject: string` prop would not have worked. English has no such constraint,
but the per-type structure stays because German needs it.

**`badgeClass` moves out of the locale-keyed record.** It is a CSS class, not
copy. Keeping it inside would store `"badge-success"` twice and permit the two
locales to drift on a non-linguistic value. It becomes:

```ts
export const BADGE_CLASS: Record<CardFaceState, string>;
```

and `CardFaceCopy` loses the field. This is a targeted improvement to code the
change is already rewriting, not unrelated refactoring.

### `card-state.ts`

`cardFaceState()` is locale-independent and does not change — it collapses
persisted state and session state into a face state, and its session-scoped
`offered` rationale is untouched.

`STATE_COPY` (currently a re-export of `FACE_COPY[DPC]`) becomes:

```ts
export function stateCopy(locale: Locale, state: CardFaceState): CardFaceCopy;
```

### `format.ts`

Each `Intl` singleton becomes a `Record<Locale, …>` built once at module scope,
so instances are still constructed once per locale rather than per call.

Locale tags: `de` → `de-DE`, `en` → `en-IE`. `en-IE` is the euro-native English
locale and yields correct currency placement without overrides.

This does **not** contradict the root `AGENTS.md` warning about `de-DE` versus
`en-IE`. That warning is against *replacing* the bank's `de-DE` with the
merchant's `en-IE`. Here `de-DE` remains and `en-IE` is added beside it.

| Function | Change | German | English |
| --- | --- | --- | --- |
| `formatEuroCents(cents, locale)` | + locale | `3.487,12 €` | `€3,487.12` |
| `splitEuroCents(cents, locale)` | + locale | `3.487` / `12` | `3,487` / `12` |
| `formatBookedAt(ms, locale)` | + locale | `01.08.2025` | `01/08/2025` |
| `formatDayLabel(ms, locale)` | + locale | `Fr, 01.08.2025` | `Fri, 01/08/2025` |
| `formatIban(iban)` | unchanged | — | — |

`formatIban` stays locale-free: grouping in blocks of four is an IBAN
convention, not a locale one.

`formatBookedAt` stays hand-rolled on UTC getters rather than moving to
`Intl.DateTimeFormat`. Its existing comment gives the reason — it keeps the test
off the runner's timezone. Only the separator becomes locale-dependent. Both
locales stay day-month-first, so no `MM/DD` ambiguity is introduced; `en-IE` is
day-first anyway.

`splitEuroCents`'s `sign` stays `U+2212` in both locales.

### `ledger.ts`

`groupByDay` calls `formatDayLabel`, so it takes a trailing `locale`.

### `layout.tsx`

- `<html lang="de">` becomes `<html lang={locale}>`.
- The static `metadata` export becomes `generateMetadata()`, reading the cookie.
- `title` stays `"Sparkasse Musterstadt"` — a proper noun.
- `description` translates.

The `next/font` choice does not change. Fira Sans was picked for German
compounds; it renders English perfectly well, and the app keeps its Sparkasse
identity in both languages.

## The switcher

`LocaleSwitcher.tsx`, a client component. On click:

1. Write `document.cookie` — `bank_locale=<locale>; Path=/; Max-Age=31536000; SameSite=Lax`.
2. Call `router.refresh()`.

Because every page is `force-dynamic`, the refresh re-renders server-side
against the new cookie and the whole tree — copy, `<html lang>`, metadata and
formatted amounts — returns translated. No API route, no middleware, and no
client-side mirror of the language that could disagree with the cookie.

The cookie is deliberately **not** `HttpOnly`, unlike `bank_session`. It carries
no authority; making it `HttpOnly` would force a round trip through a route
handler to change a display preference.

### Where it renders — two places

- `AppHeader`, in both the desktop row and the open mobile menu.
- The login screen, via `login/page.tsx` (a server component, which passes the
  locale it already resolved).

The login placement is required by the decision that English is the default: a
German-speaking user's very first screen is now an English login page. A
switcher only behind auth would force them to sign in in a language they may not
read before they could change it.

Presentation: a compact `EN | DE` pair, active item marked with `aria-current`,
at the right edge of the header rule. Two buttons, not a `<select>` — with two
options a toggle is one click and shows both states.

## String inventory

Roughly 90 strings. Proper nouns that stay untranslated in both catalogs:
**Sparkasse**, **Musterstadt**, **Sparkassen Card**, **girocard**, **IBAN**,
**EUDI Wallet**, and the demo credentials line `anna / demo1234 · ben / demo1234`.

| Source | Strings |
| --- | --- |
| `layout.tsx` | metadata description |
| `login/page.tsx` | tagline |
| `AuthCard.tsx` | footer line |
| `LoginForm.tsx` | field labels, submit + pending labels, demo-logins eyebrow, two error strings |
| `page.tsx` | greeting, three section headings, "show all" |
| `transactions/page.tsx` | page title, page counter, empty label, pagination aria-label, prev/next |
| `AppHeader.tsx` | two nav labels, logo aria-label, sign out, menu |
| `AccountPanel.tsx` | account type, available-balance label |
| `CardTile.tsx` | two error strings |
| `AgeCredentialTile.tsx` | heading, two error strings |
| `AddToWalletButton.tsx` | idle + pending labels |
| `IssuanceDialog.tsx` | instructions, open-in-wallet, cancel, close, failed heading, waiting label, QR aria-label, expiry + connection errors, **two DC API diagnostics** |
| `TransactionLedger.tsx` | empty label |
| `TransactionRow.tsx` | wallet badge (proper noun — stays) |
| `credential-copy.ts` | 12 face strings + 8 dialog strings |

### DC API diagnostics

`apps/bank/AGENTS.md` currently records: *"DC API diagnostic strings are
English; all other copy stays German."* That decision is **superseded**. Both
strings move into the catalog and gain German translations, and the note is
rewritten to say so. The original reasoning — that a browser-capability failure
is a technical signal rather than customer copy — no longer holds once a German
customer can encounter it in an otherwise fully German UI.

## Testing

All tests are `.ts`, per the testability constraint.

**`i18n/locale.test.ts`** — `resolveLocale`, with expectations stated so the
normalisation boundary is pinned rather than inferred:

| Input | Result |
| --- | --- |
| `undefined` | `"en"` |
| `""` | `"en"` |
| `"en"` | `"en"` |
| `"de"` | `"de"` |
| `"DE"` | `"de"` |
| `" de "` | `"de"` |
| `"de-DE"` | `"en"` |
| `"fr"` | `"en"` |
| junk (e.g. `"<script>"`) | `"en"` |

**`i18n/messages.test.ts`** — catalog integrity. TypeScript already guarantees
matching *keys*; this asserts semantics the compiler cannot:

- every leaf is a non-empty string, or a function returning a non-empty string;
- no leaf in the `en` catalog contains `äöüßÄÖÜ`;
- no leaf is byte-identical between the two locales except for an explicit
  allowlist of the proper nouns listed above.

That last check is what catches a half-finished translation, which is the
realistic failure mode for this change.

**Extended:** `format.test.ts`, `ledger.test.ts`, `credential-copy.test.ts`,
`card-state.test.ts` — each gains its second-locale cases.

No test-count projection is given. Three prior plans in this repo projected
totals that were wrong, and root `AGENTS.md` instructs measuring rather than
trusting a number written in a plan. The baseline is **357** as of 2026-08-20;
the new number will be measured.

## Verification

- `pnpm check` green from the repo root.
- `tools/cdp/cdp.mjs` driving real headless Chrome through `/login`, `/`, and
  `/transactions`, toggling the switcher in each and asserting on rendered text
  and on formatted amounts — not on server-rendered HTML.
- The wallet leg remains unexercisable here (no device, no wallet app). The
  issuance dialog's copy will be verified in its rendered states; an actual
  wallet handover will not be. This will be stated plainly rather than implied.

## Out of scope

- `apps/merchant` — English already, and its design tokens are deliberately not
  shared with the bank.
- `display-metadata.ts` — stays `en-US`.
- Seeded transaction descriptions and card aliases. These are booking records
  and product names; a real bank does not translate them.
- Any third language. `Locale` is a closed union, so adding one later is a
  compile-error-guided exercise rather than a redesign.
- Per-user persistence of the choice. The cookie is per browser, which is what a
  demo needs.

## Documentation to update

- Root `AGENTS.md` — the "German UI" characterisation, the test baseline.
- `apps/bank/AGENTS.md` — Identity, Formatting, Copy, and the superseded DC API
  diagnostics note.
