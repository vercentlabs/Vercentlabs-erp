import { transitionProject } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { projectsContext } from "@/modules/projects";
import { projectActionSchema } from "@/modules/projects/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("projects");
    const { id } = await params;
    const { action } = projectActionSchema.parse(await request.json());
    const row = await tenantTransaction(session.organizationId, (client) =>
      transitionProject(client, projectsContext(session), id, action),
    );
    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
