import { z } from "zod";

import { assertSameOriginOrMobile, createRole, listOrganizationRolesDetailed } from "@vercentlabs/api";

import { transaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

export async function GET() {
  try {
    const session = await requireApiWorkspace();
    const roles = await withClient((client) => listOrganizationRolesDetailed(client, session));
    return ok({ roles });
  } catch (error) {
    return errorResponse(error);
  }
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  moduleKey: z.string().trim().min(1).max(50).optional(),
  riskLevel: z.enum(["standard", "sensitive", "privileged"]).optional(),
  permissionKeys: z.array(z.string().trim().min(1)).max(500).optional(),
  acknowledgeWarningConflicts: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const body = postSchema.parse(await readJson(request));
    const role = await transaction((client) => createRole(client, session, body));
    return ok({ role }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
