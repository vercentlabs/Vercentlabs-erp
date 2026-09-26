import { z } from "zod";

import { setReportDefinitionStatus } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The creator (or a holder of platform.reports.manage) archives or restores it.
const schema = z.object({ status: z.enum(["active", "inactive"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(request, { action: "reports.definitions.status" }, async ({ client, session }) =>
    ok({ definition: await setReportDefinitionStatus(client, session, id, schema.parse(await readJson(request)).status) }),
  );
}
