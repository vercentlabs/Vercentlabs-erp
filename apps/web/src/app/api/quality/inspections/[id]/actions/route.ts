import { completeInspection, releaseInspection } from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { qualityContext } from "@/modules/quality";
import { qualityInspectionActionSchema } from "@/modules/quality/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("quality");
    const { id } = await params;
    const input = qualityInspectionActionSchema.parse(await request.json());

    const row = await tenantTransaction(session.organizationId, (client) => {
      if (input.action === "complete") {
        return completeInspection(client, qualityContext(session), id, input);
      }
      return releaseInspection(client, qualityContext(session), id, input);
    });

    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
