import { listReportDatasets } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Datasets the caller may use: module released + enabled + entitled (snapshot)
// and the dataset's permissions. Everyone else sees an empty list.
export async function GET(request: Request) {
  return workspaceRoute(request, { snapshot: true, action: "reports.datasets", transaction: "none" }, async ({ session, snapshot }) =>
    ok({ datasets: listReportDatasets(session, snapshot?.accessibleModules ?? []) }),
  );
}
