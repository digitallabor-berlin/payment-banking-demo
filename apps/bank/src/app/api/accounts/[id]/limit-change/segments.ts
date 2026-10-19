/**
 * Reading the dynamic segments off a limit-change URL.
 *
 * `withSession` hands its handler `(session, request)` and **nothing else** —
 * no `params` argument — so every dynamic segment is read from the URL.
 *
 * Split as a plain string rather than through `new URL(..)`, which THROWS on a
 * value it cannot parse. Nothing here may throw on a request shape we did not
 * anticipate: an unreadable id must fall through to the same 404 as an absent
 * one, never become a 500. The same rule `GET /api/transactions/{id}/proof`
 * already follows, and the reason it splits rather than parses.
 *
 * In its own module, with its own tests through the routes, because four
 * handlers read these at four different offsets and a wrong `.at()` is
 * invisible until something 404s for the wrong reason:
 *
 * | route                                 | accountId | sessionId |
 * | ---                                   | ---       | ---       |
 * | `POST …/limit-change`                 | `.at(-2)` | —         |
 * | `GET …/limit-change/{sessionId}`      | `.at(-3)` | `.at(-1)` |
 * | `POST …/{sessionId}/apply`            | `.at(-4)` | `.at(-2)` |
 * | `POST …/{sessionId}/dc-api-response`  | `.at(-4)` | `.at(-2)` |
 */

/** The path's segments, query string discarded. */
function segments(request: Request): string[] {
  return request.url.split("?")[0]!.split("/");
}

/** `POST /api/accounts/{accountId}/limit-change` */
export function accountIdFromStart(request: Request): string {
  return segments(request).at(-2) ?? "";
}

/** `GET /api/accounts/{accountId}/limit-change/{sessionId}` */
export function fromPoll(request: Request): {
  accountId: string;
  sessionId: string;
} {
  const parts = segments(request);
  return { accountId: parts.at(-3) ?? "", sessionId: parts.at(-1) ?? "" };
}

/** `POST …/limit-change/{sessionId}/apply` and `…/dc-api-response`. */
export function fromSessionAction(request: Request): {
  accountId: string;
  sessionId: string;
} {
  const parts = segments(request);
  return { accountId: parts.at(-4) ?? "", sessionId: parts.at(-2) ?? "" };
}