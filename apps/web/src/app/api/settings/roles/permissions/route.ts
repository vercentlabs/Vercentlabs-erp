import { listPermissionCatalog } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

export async function GET() {
  try {
    const session = await requireApiWorkspace();
    const permissions = await withClient((client) => listPermissionCatalog(client, session));
    return ok({ permissions });
  } catch (error) {
    return errorResponse(error);
  }
}
