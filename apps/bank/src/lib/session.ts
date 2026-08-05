import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { env } from "../env.js";

export const SESSION_COOKIE = "bank_session";

const ALG = "HS256";
const TTL = "12h";

export interface SessionPayload {
  userId: string;
  displayName: string;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId, displayName: payload.displayName })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secretKey());
}

/** Returns null for any token that is invalid, tampered, expired, or malformed. */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALG] });
    const userId = payload["userId"];
    const displayName = payload["displayName"];
    if (typeof userId !== "string" || typeof displayName !== "string") return null;
    if (userId.length === 0) return null;
    return { userId, displayName };
  } catch {
    return null;
  }
}

/** Reads and verifies the session cookie. Usable in route handlers and RSCs. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return token ? verifySession(token) : null;
}

export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}