import { NextResponse } from "next/server";
import { requireSession, UnauthorizedError, type SessionPayload } from "./session.js";

export type SessionHandler = (
  session: SessionPayload,
  request: Request,
) => Promise<Response>;

/**
 * Wraps a route handler so it only runs with a valid session, turning
 * UnauthorizedError into a 401 instead of a 500.
 */
export function withSession(handler: SessionHandler) {
  return async (request: Request): Promise<Response> => {
    let session: SessionPayload;
    try {
      session = await requireSession();
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
      }
      throw error;
    }
    return handler(session, request);
  };
}