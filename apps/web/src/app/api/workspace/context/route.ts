import { z } from "zod";

import { switchActiveCompany } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";

const switchSchema = z.object({
  companyId: z.string().uuid(),
  branchId: z.string().uuid().optional().nullable(),
});

export async function PATCH(request: Request) {
  try {
    const session = await requireWorkspace();
    const body = switchSchema.parse(await readJson(request));
    const result = await withClient((client) =>
      switchActiveCompany(
        client,
        session,
        body.companyId,
        body.branchId ?? null,
      ),
    );
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
