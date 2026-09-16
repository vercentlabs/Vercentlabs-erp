import { findAccountDuplicates, findContactDuplicates, getCrmRecord } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F022 pre-conversion review. Read-only: runs the exact same governed
// duplicate engine (findAccountDuplicates/findContactDuplicates) that
// convertCrmLead itself uses internally to decide create-vs-reuse, so
// what this preview shows is the literal truth of what conversion would
// do — not a second, hand-rolled approximation. Nothing is created or
// mutated here; the caller reviews the candidates, then calls the real
// POST .../convert with an explicit partyId/contactId to force reuse of
// a shown candidate, or omits them to accept convertCrmLead's own
// default (auto-reuse only an "exact" match, otherwise create new).
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      const lead = (await getCrmRecord(client, crmContext(session), "leads", id)) as Record<string, unknown>;
      const [accountCandidates, contactCandidates] = await Promise.all([
        findAccountDuplicates(client, crmContext(session), {
          name: lead.companyName || lead.fullName || `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
        }),
        findContactDuplicates(client, crmContext(session), {
          email: lead.email,
          mobile: lead.mobile || lead.phone,
          firstName: lead.firstName,
          lastName: lead.lastName,
        }),
      ]);
      return { accountCandidates, contactCandidates };
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
