import { z } from "zod";

import { advanceNumberingCounter } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Moves a counter forward only (the domain refuses anything lower than the
// current next number, so an issued identifier is never re-issued). Audited.
const schema = z.object({ documentType: z.string().trim().min(1).max(160), companyId: z.string().uuid().nullable().optional(), nextValue: z.number().int().min(1) });

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.numberingManage, action: "numbering.counter_advance", auditDenial: true },
    async ({ client, session }) => ok({ counter: await advanceNumberingCounter(client, session, schema.parse(await readJson(request))) }),
  );
}
