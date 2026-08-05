import { completeInspection, releaseInspection } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { qualityContext } from "@/lib/quality";
import { qualityInspectionActionSchema } from "@/lib/quality-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
  const { id } = await params;
  const input = qualityInspectionActionSchema.parse(await request.json());

  const row = await tenantTransaction(session.organizationId, (client) => {
    if (input.action === "complete") {
      return completeInspection(client, qualityContext(session), id, input);
    }
    return releaseInspection(client, qualityContext(session), id, input);
  });

  return NextResponse.json({ ok: true, row });
}
