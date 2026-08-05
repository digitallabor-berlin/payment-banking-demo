import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/db/index.js";
import { users } from "@/db/schema.js";
import { verifyPassword } from "@/lib/password.js";
import { SESSION_COOKIE, signSession } from "@/lib/session.js";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const db = getDb();
  const user = db
    .select()
    .from(users)
    .where(eq(users.username, parsed.data.username))
    .get();

  // Same response for unknown user and wrong password: never reveal which.
  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const token = await signSession({ userId: user.id, displayName: user.displayName });
  const response = NextResponse.json({
    userId: user.id,
    displayName: user.displayName,
  });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}