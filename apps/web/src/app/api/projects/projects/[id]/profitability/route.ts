import { getProjectProfitability } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { projectsContext } from "@/modules/projects";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("projects");
    const { id } = await params;
    const data = await tenantTransaction(session.organizationId, (client) =>
      getProjectProfitability(client, projectsContext(session), id),
    );
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return errorResponse(error);
  }
}
