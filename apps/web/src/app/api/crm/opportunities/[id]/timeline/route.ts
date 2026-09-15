import { getCrmRecordTimelinePage } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const page = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return getCrmRecordTimelinePage(client, crmContext(session), "opportunity", id, { cursor: cursor ?? undefined, limit });
    });
    return ok({ page });
  } catch (error) {
    return errorResponse(error);
  }
}
