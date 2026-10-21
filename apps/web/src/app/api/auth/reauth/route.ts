import { z } from "zod";

import { assertSameOrigin, codeError, requestReauthCode, verifyReauthCode } from "@vercentlabs/api";

import { sessionTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiUser } from "@/core/session";

// "Confirm it's you" for someone without a password. GET: whether they have a password. POST { action: request } sends a code;
// POST { action: verify, code } confirms this session for 10 minutes.
export async function GET() {
  try {
    const session = await requireApiUser();
    const row = await sessionTransaction(session, async (client) => (await client.query(`SELECT password_hash IS NOT NULL AS has_password FROM public.users WHERE id = $1`, [session.userId])).rows[0]);
    return ok({ hasPassword: Boolean(row?.has_password) });
  } catch (error) {
    return errorResponse(error);
  }
}
const schema = z.object({ action: z.enum(["request", "verify"]), code: z.string().max(12).optional() });
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const session = await requireApiUser();
    const body = schema.parse(await readJson(request));
    if (body.action === "request") return ok(await sessionTransaction(session, (client) => requestReauthCode(client, session, process.env)));
    const result = await sessionTransaction(session, (client) => verifyReauthCode(client, session, body.code ?? ""));
    if (!result.ok) throw codeError(result.reason);
    return ok({ confirmed: true });
  } catch (error) {
    return errorResponse(error);
  }
}
