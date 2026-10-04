import { listMergedRecords } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The latest merges: which record was folded into which.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.duplicatesReview }, async ({ client, session }) => ok({ merged: await listMergedRecords(client, crmContext(session)) }));
}
