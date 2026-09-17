import { listPosStoreSetupOptions } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

export async function GET() {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage");
      return listPosStoreSetupOptions(client, posContext(session));
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
