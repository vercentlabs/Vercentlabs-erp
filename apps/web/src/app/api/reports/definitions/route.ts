import { z } from "zod";

import { createReportDefinition, listReportDefinitions } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "reports.definitions.list", transaction: "none" }, async ({ client, session, snapshot }) =>
    ok({ definitions: await listReportDefinitions(client, session, snapshot?.accessibleModules ?? []) }),
  );
}

// Columns and filters are validated against the registered dataset; a
// schedule is refused (scheduled reports are not available).
const schema = z.object({
  name: z.string().trim().min(1).max(160),
  datasetKey: z.string().max(120),
  columns: z.array(z.string().max(80)).max(100).optional(),
  filters: z.record(z.string(), z.string().max(200)).optional(),
  schedule: z.unknown().optional(),
});

export async function POST(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "reports.definitions.create", transaction: "platform" }, async ({ client, session, snapshot }) =>
    ok({ definition: await createReportDefinition(client, session, snapshot?.accessibleModules ?? [], schema.parse(await readJson(request))) }, 201),
  );
}
