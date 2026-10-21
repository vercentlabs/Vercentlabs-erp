import { assertSameOrigin, resendSignupCode } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { readSignupToken } from "@/features/auth/signup-cookie";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const token = await readSignupToken();
    return ok(await ingressTransaction((client) => resendSignupCode(client, token ?? "", process.env)));
  } catch (error) {
    return errorResponse(error);
  }
}
