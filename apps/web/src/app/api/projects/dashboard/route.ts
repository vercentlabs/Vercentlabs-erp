import { getProjectsDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { projectsContext } from "@/modules/projects";

export async function GET() {
  try {
    const session = await requireModuleWorkspace("projects");
    const data = await tenantTransaction(session.organizationId, (client) =>
      getProjectsDashboard(client, projectsContext(session)),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
