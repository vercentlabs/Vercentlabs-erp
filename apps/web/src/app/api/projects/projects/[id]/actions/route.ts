import { transitionProject } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { projectsContext } from "@/lib/projects";
import { projectActionSchema } from "@/lib/projects-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const { action } = projectActionSchema.parse(await request.json());
  const row = await tenantTransaction(session.organizationId, (client) =>
    transitionProject(client, projectsContext(session), id, action),
  );
  return NextResponse.json({ ok: true, row });
}
