import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";
import type { StartedPaymentSession } from "./payment-sessions.js";
import type { PresentationTransport } from "./transport.js";

/**
 * The payment sheet's props, as one serialisable object.
 *
 * This crosses the server/client boundary as a prop, so it holds only JSON —
 * no functions, no Date. `merchantName` is deliberately absent: it comes from
 * `env` at each call site, which keeps this module out of env validation and
 * therefore trivially testable.
 */
export interface SheetSession {
 sessionId: string;
 orderId: string;
 amountCents: number;
 /** Empty string under a DC API transport — there is no URI to navigate to. */
 openid4vpUri: string;
 transport: PresentationTransport;
 /** True when this session presents the `payment_av` named query. */
 ageRequested: boolean;
 dcApiRequest: unknown;
 /**
  * The DC API exchange protocol identifier foundry returned for this session,
  * replayed verbatim into `navigator.credentials.get()`. Null under
  * request_uri. Carried on the session rather than recomputed in the component
  * so the identifier and the request object cannot drift apart.
  */
 dcApiProtocol: string | null;
 initialState: string;
 initialFailureReason?: string;
}

/**
 * Re-opens the sheet from `/checkout?session=<id>`.
 *
 * Needed because a coarse-pointer wallet handover navigates the tab away with
 * `window.location.href`; when the wallet returns the shopper, `/checkout`
 * re-mounts with no client state at all. The session id in the URL is the only
 * thing that survives, so it is what the sheet is rebuilt from.
 *
 * Returns null rather than throwing for an unknown id: a stale or hand-edited
 * `?session=` should render the ordinary checkout form, not an error page.
 */
export function loadCheckoutSession(
 db: Db,
 sessionId: string,
): SheetSession | null {
 const session = db
  .select()
  .from(paymentSessions)
  .where(eq(paymentSessions.id, sessionId))
  .get();
 if (!session) return null;

 const order = db
  .select()
  .from(orders)
  .where(eq(orders.id, session.orderId))
  .get();
 if (!order) return null;

 return {
  sessionId: session.id,
  orderId: order.id,
  amountCents: order.totalCents,
  openid4vpUri: session.openid4vpUri ?? session.requestUri ?? "",
  transport: session.transport,
  ageRequested: session.namedQueryRef === "payment_av",
  dcApiRequest: session.dcApiRequestJson
   ? JSON.parse(session.dcApiRequestJson)
   : null,
  dcApiProtocol: session.dcApiProtocol ?? null,
  initialState: session.state,
  ...(session.failureReason
   ? { initialFailureReason: session.failureReason }
   : {}),
 };
}

/**
 * The OTHER constructor of `SheetSession`: from a session just created, rather
 * than from a stored row.
 *
 * Both exist because the sheet must have its props — including the DC API
 * request object — before the shopper's click, since Chrome consumes a click's
 * transient activation and no `await` may run inside the handler. So a fresh
 * session is answered over HTTP directly instead of being read back.
 *
 * That makes it two projections of one type, and the pair is the hazard. This
 * used to be an object literal inside `POST /api/payment-sessions` under two
 * DIFFERENT member names (`uri`, `state`), which forced a third hand-written
 * re-map in `CheckoutForm` — and one of the three lost `dcApiProtocol`, which
 * broke every merchant DC API payment on its first attempt while a reload
 * appeared to fix it, because a reload takes `loadCheckoutSession` instead.
 *
 * The `SheetSession` return annotation is the guard: a member added to the
 * sheet's props and forgotten here is now a compile error rather than a
 * runtime `undefined` behind an `as` cast. Keep it annotated — inferring the
 * return type would silently restore the old failure mode.
 *
 * No `initialFailureReason`: this branch's `state` is the literal `"pending"`,
 * so a session cannot be born failed and the member has nothing to report.
 */
export function sheetSessionFromStart(
 started: StartedPaymentSession,
): SheetSession {
 return {
  sessionId: started.sessionId,
  orderId: started.orderId,
  amountCents: started.amountCents,
  // The sheet takes a string; a DC API session has no URI at all, and its QR
  // branch is chosen by `transport` rather than by this being empty.
  openid4vpUri: started.uri ?? "",
  transport: started.transport,
  ageRequested: started.ageRequested,
  dcApiRequest: started.dcApiRequest,
  dcApiProtocol: started.dcApiProtocol,
  initialState: started.state,
 };
}
