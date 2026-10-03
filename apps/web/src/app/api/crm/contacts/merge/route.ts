import { mergeContacts, previewContactMerge } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/contacts/server/contact-http";

// The side-by-side merge preview. Query: keepId, duplicateId.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsMerge }, async ({ client, session }) => {
    const url = new URL(request.url);
    const keepId = url.searchParams.get("keepId");
    const duplicateId = url.searchParams.get("duplicateId");
    if (!keepId || !duplicateId) throw new HttpError(400, "Choose the two contacts to merge.");
    return ok({ preview: await previewContactMerge(client, crmContext(session), keepId, duplicateId) });
  });
}

// Body: { keepId, duplicateId, choices: { [field]: "keep" | "duplicate" } }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsMerge, billingWrite: true }, async ({ client, session }) => {
    const body = await readBody(request);
    return ok({
      merge: await mergeContacts(client, crmContext(session), {
        keepId: String(body.keepId ?? ""),
        duplicateId: String(body.duplicateId ?? ""),
        choices: (body.choices ?? {}) as Record<string, "keep" | "duplicate">,
      }),
    });
  });
}
