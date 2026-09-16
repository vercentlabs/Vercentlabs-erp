import { assertSameOriginOrMobile, transitionPrivacyRequest } from "@vercentlabs/api";

import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { transaction } from "@/core/db";
import { requireWorkspace } from "@/core/session";
import { assertPrivacyManage } from "@/core/privacy-authorization";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    assertPrivacyManage(session);
    const { id } = await context.params;
    const input = (await readJson(request)) as { status?: string; resultPayload?: unknown };
    const status = input.status;
    if (!status) throw new HttpError(400, "A target status is required.");
    const record = await transaction((client) => transitionPrivacyRequest(client, session, id, status, input.resultPayload));
    return ok({ record });
  } catch (error) {
    return errorResponse(error);
  }
}
