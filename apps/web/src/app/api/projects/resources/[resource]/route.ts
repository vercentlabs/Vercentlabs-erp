import {
  createProject,
  createProjectTask,
  createTimeEntry,
  listProjectResource,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { projectsContext } from "@/lib/projects";
import {
  projectCreateSchema,
  taskCreateSchema,
  timeEntryCreateSchema,
} from "@/lib/projects-validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listProjectResource(client, projectsContext(session), resource, {
      projectId: request.nextUrl.searchParams.get("projectId"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 100),
      offset: Number(request.nextUrl.searchParams.get("offset") || 0),
    }),
  );
  return NextResponse.json({ ok: true, rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const body = await request.json();

  const row = await tenantTransaction(session.organizationId, (client) => {
    if (resource === "projects") {
      return createProject(
        client,
        projectsContext(session),
        projectCreateSchema.parse(body),
      );
    }
    if (resource === "tasks") {
      return createProjectTask(
        client,
        projectsContext(session),
        taskCreateSchema.parse(body),
      );
    }
    if (resource === "time-entries") {
      return createTimeEntry(
        client,
        projectsContext(session),
        timeEntryCreateSchema.parse(body),
      );
    }
    throw new Error("Creation is not supported for this resource.");
  });

  return NextResponse.json({ ok: true, row }, { status: 201 });
}
