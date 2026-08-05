import { getProjectProfitability } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { projectsContext } from "@/lib/projects";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const data = await tenantTransaction(session.organizationId, (client) =>
    getProjectProfitability(client, projectsContext(session), id),
  );
  return NextResponse.json({ ok: true, data });
}
