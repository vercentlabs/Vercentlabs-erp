import { markNotDuplicate, unmarkNotDuplicate } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Pair = { recordTypeA: string; recordIdA: string; recordTypeB: string; recordIdB: string; reason?: string };

// Body: { recordTypeA, recordIdA, recordTypeB, recordIdB, reason? } — the pair is not reported again.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.duplicatesReview, billingWrite: true }, async ({ client, session }) =>
    ok(await markNotDuplicate(client, crmContext(session), (await readBody(request)) as Pair)),
  );
}

// Withdraws the exclusion.
export async function DELETE(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.duplicatesReview, billingWrite: true }, async ({ client, session }) =>
    ok(await unmarkNotDuplicate(client, crmContext(session), (await readBody(request)) as Pair)),
  );
}
