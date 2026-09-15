import { assertSameOriginOrMobile, createCustomFieldDefinition, listCustomFieldDefinitions } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F028 runtime custom fields — governed setup for definitions bound to a
// BUILT-IN entity type (lead/opportunity/party/contact), using the
// platform-level custom_field_definitions table. Distinct from
// crm-custom-object-definitions (the tenant-defined custom OBJECT
// system) — see custom-field-runtime.js's own module comment.
export async function GET(_request: Request, context: { params: Promise<{ entityType: string }> }) {
  try {
    const session = await requireWorkspace();
    const { entityType } = await context.params;
    const rows = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listCustomFieldDefinitions(client, crmContext(session), entityType as never);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ entityType: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { entityType } = await context.params;
    const input = (await readJson(request)) as Record<string, unknown>;
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.settingsManage);
      return createCustomFieldDefinition(client, crmContext(session), { ...input, entityType });
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
