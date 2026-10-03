import { countUserActiveLeads, transferUserLeads } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

import { HttpError } from "@/core/http";

// GET ?userId= — how many active leads the user still owns.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) => {
    const userId = new URL(request.url).searchParams.get("userId");
    if (!userId) throw new HttpError(400, "Choose a user.");
    return ok({ leads: await countUserActiveLeads(client, crmContext(session), userId) });
  });
}

// Transfer Active Leads. Body: { fromUserId, toUserId?, teamId?, useRules?, reason? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsManageAssignmentRules, billingWrite: true }, async ({ client, session }) =>
    ok(await transferUserLeads(client, crmContext(session), (await readBody(request)) as Parameters<typeof transferUserLeads>[2])),
  );
}
