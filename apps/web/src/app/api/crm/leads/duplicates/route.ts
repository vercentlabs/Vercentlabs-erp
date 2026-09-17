import { assertSameOriginOrMobile, findCrmDuplicates } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F008 possible-duplicate check, called while composing a new/edited
// lead — never auto-merges; the UI shows candidates and requires an
// explicit authorized decision (see /api/crm/leads/[id]/merge).
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { input: Record<string, unknown>; excludeId?: string | null };
    const duplicates = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return findCrmDuplicates(client, crmContext(session), body.input, body.excludeId ?? null);
    });
    return ok({ duplicates });
  } catch (error) {
    return errorResponse(error);
  }
}
