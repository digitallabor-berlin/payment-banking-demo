/**
 * Reading the dynamic segment off a phone-change URL.
 *
 * `withSession` hands its handler `(session, request)` and **nothing else** —
 * no `params` argument — so every dynamic segment is read from the URL.
 *
 * Split as a plain string rather than through `new URL(..)`, which THROWS on a
 * value it cannot parse. Nothing here may throw on a request shape we did not
 * anticipate: an unreadable id must fall through to the same 404 as an absent
 * one, never become a 500. The same rule `GET /api/transactions/{id}/proof`
 * already follows.
 *
 * There is only ONE segment to read, unlike the limit change's two: this flow
 * names no account, because a mobile number belongs to the customer rather
 * than to an account. In its own module anyway, because three handlers read it
 * at two different offsets and a wrong `.at()` is invisible until something
 * 404s for the wrong reason:
 *
 * | route                                   | sessionId |
 * | ---                                     | ---       |
 * | `POST …/phone-change`                   | —         |
 * | `GET …/phone-change/{sessionId}`        | `.at(-1)` |
 * | `POST …/{sessionId}/apply`              | `.at(-2)` |
 * | `POST …/{sessionId}/dc-api-response`    | `.at(-2)` |
 */

/** The path's segments, query string discarded. */
function segments(request: Request): string[] {
  return request.url.split("?")[0]!.split("/");
}

/** `GET /api/profile/phone-change/{sessionId}` */
export function sessionIdFromPoll(request: Request): string {
  return segments(request).at(-1) ?? "";
}

/** `POST …/phone-change/{sessionId}/apply` and `…/dc-api-response`. */
export function sessionIdFromAction(request: Request): string {
  return segments(request).at(-2) ?? "";
}