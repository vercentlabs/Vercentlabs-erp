import { listDuplicateQueue } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The duplicate review queue: pairs of existing records that look alike.
// Query: type (lead_lead | lead_contact | contact_contact | account_account).
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.duplicatesReview }, async ({ client, session }) =>
    ok({ queue: await listDuplicateQueue(client, crmContext(session), { type: new URL(request.url).searchParams.get("type") ?? undefined }) }),
  );
}
