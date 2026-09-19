import { z } from "zod";

import { archiveRole, assertSameOriginOrMobile, updateRole } from "@vercentlabs/api";

import { transaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

const putSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  riskLevel: z.enum(["standard", "sensitive", "privileged"]).optional(),
  permissionKeys: z.array(z.string().trim().min(1)).max(500).optional(),
  acknowledgeWarningConflicts: z.boolean().optional(),
});

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const { id } = await context.params;
    const body = putSchema.parse(await readJson(request));
    const role = await transaction((client) => updateRole(client, session, id, body));
    return ok({ role });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const { id } = await context.params;
    await transaction((client) => archiveRole(client, session, id));
    return ok({ archived: true });
  } catch (error) {
    return errorResponse(error);
  }
}
