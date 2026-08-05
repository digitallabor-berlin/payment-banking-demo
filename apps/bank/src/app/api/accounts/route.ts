import { NextResponse } from "next/server";
import { getDb } from "@/db/index.js";
import { withSession } from "@/lib/api.js";
import { listAccounts } from "@/lib/queries.js";

export const dynamic = "force-dynamic";

export const GET = withSession(async (session) =>
  NextResponse.json({ accounts: listAccounts(getDb(), session.userId) }),
);