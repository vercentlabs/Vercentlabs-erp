import { createCustomFieldDefinition, listCustomFieldDefinitions } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F028 runtime custom fields — governed setup for definitions bound to a
// BUILT-IN entity type (lead/opportunity/party/contact), using the
// platform-level custom_field_definitions table. Distinct from
// crm-custom-object-definitions (the tenant-defined custom OBJECT
// system) — see custom-field-runtime.js's own module comment.
export async function GET(request: Request, context: { params: Promise<{ entityType: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { entityType } = await context.params;
    const rows = await listCustomFieldDefinitions(client, crmContext(session), entityType as never);
    return ok({ rows });
  });
}

export async function POST(request: Request, context: { params: Promise<{ entityType: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session }) => {
    const { entityType } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await createCustomFieldDefinition(client, crmContext(session), { ...input, entityType });
    return ok({ record }, 201);
  });
}
