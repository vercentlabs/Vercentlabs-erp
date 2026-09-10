import { listCrmAttachmentVersions } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Params = { params: Promise<{ id: string; attachmentId: string }> };

// F017 §CRM-VNEXT-053 closeout — `attachmentId` here is the logical file's
// id (stable across versions), not one version's own row id. Returns the
// full version history so a "replace this file" upload never looks like it
// silently created an unrelated attachment.
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsViewSensitive);
    const { id, attachmentId } = await params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(attachmentId);
    const context = await crmApiContext(session);
    const versions = await tenantTransaction(context.organizationId, (client) =>
      listCrmAttachmentVersions(client, context, "party", id, attachmentId),
    );
    return ok({ versions });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
