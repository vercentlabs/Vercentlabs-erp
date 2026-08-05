import { getProjectsDashboard } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { projectsContext } from "@/lib/projects";

export async function GET() {
  const session = await requireApiWorkspace();
  const data = await tenantTransaction(session.organizationId, (client) =>
    getProjectsDashboard(client, projectsContext(session)),
  );
  return NextResponse.json({ ok: true, data });
}
