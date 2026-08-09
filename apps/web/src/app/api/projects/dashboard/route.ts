import { getProjectsDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { requireModuleWorkspace } from "@/lib/module-access";
import { projectsContext } from "@/lib/projects";

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
