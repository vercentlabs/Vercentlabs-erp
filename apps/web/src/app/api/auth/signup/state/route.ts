import { getSignupState } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { readSignupToken } from "@/features/auth/signup-cookie";

// What Screens 3 and 4 show: still reading ("wait"), what the business does ("describe") or the suggested apps ("apps").
export async function GET() {
  try {
    const token = (await readSignupToken()) ?? "";
    return ok({ state: await ingressTransaction((client) => getSignupState(client, token)) });
  } catch (error) {
    return errorResponse(error);
  }
}
