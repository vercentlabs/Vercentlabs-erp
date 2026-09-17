import { listAccessibleCompanies } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";

export async function GET() {
  try {
    const session = await requireWorkspace();
    const companies = await withClient((client) =>
      listAccessibleCompanies(client, session.organizationId, session.userId),
    );
    return ok({ companies });
  } catch (error) {
    return errorResponse(error);
  }
}
