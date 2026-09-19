import { listOrganizationMembers } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

export async function GET() {
  try {
    const session = await requireApiWorkspace();
    const members = await withClient((client) => listOrganizationMembers(client, session));
    return ok({ members });
  } catch (error) {
    return errorResponse(error);
  }
}
