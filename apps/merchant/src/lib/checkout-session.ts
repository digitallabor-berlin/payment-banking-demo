import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { orders, paymentSessions } from "../db/schema.js";

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
  /** Empty string under dc_api — there is no URI to navigate to. */
  openid4vpUri: string;
  transport: "request_uri" | "dc_api";
  /** True when this session presents the `payment_av` named query. */
  ageRequested: boolean;
  dcApiRequest: unknown;
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
    initialState: session.state,
    ...(session.failureReason
      ? { initialFailureReason: session.failureReason }
      : {}),
  };
}
