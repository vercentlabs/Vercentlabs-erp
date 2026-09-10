import { listCrmNoteVersions } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";

type Params = { params: Promise<{ noteId: string }> };

// F017 §22 closeout — "never silently overwrite old content": this exposes
// the append-only version ledger a stale-write conflict (and every prior
// edit) leaves behind. getCrmNote's own parent/private-visibility gate
// runs first inside listCrmNoteVersions, so this never leaks a private
// Note's history to anyone but its author or a view-all override.
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { noteId } = await params;
    assertCrmIdentifier(noteId);
    const context = await crmApiContext(session);
    const versions = await tenantTransaction(context.organizationId, (client) => listCrmNoteVersions(client, context, noteId));
    return ok({ versions });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
