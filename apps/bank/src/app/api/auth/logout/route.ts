import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session.js";

export const dynamic = "force-dynamic";

export function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}