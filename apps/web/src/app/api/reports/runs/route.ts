import { z } from "zod";

import { listReportRuns, requestReportRun } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { action: "reports.runs.list", transaction: "none" }, async ({ client, session }) => ok({ runs: await listReportRuns(client, session) }));
}

// Queues a background run (tenant transaction: the job is tenant data). The
// worker re-checks the requester's current access before reading anything.
const schema = z.object({
  definitionId: z.string().uuid().optional(),
  datasetKey: z.string().max(120).optional(),
  columns: z.array(z.string().max(80)).max(100).optional(),
  filters: z.record(z.string(), z.string().max(200)).optional(),
});

export async function POST(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "reports.runs.create", transaction: "tenant" }, async ({ client, session, snapshot }) =>
    ok({ run: await requestReportRun(client, session, snapshot?.accessibleModules ?? [], schema.parse(await readJson(request))) }, 201),
  );
}
