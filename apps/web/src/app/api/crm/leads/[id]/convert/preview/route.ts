import { findAccountDuplicates, findContactDuplicates, getCrmRecord, projectDuplicateMatchesForCaller } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F022 pre-conversion review. Read-only: runs the exact same governed
// duplicate engine (findAccountDuplicates/findContactDuplicates) that
// convertCrmLead itself uses internally to decide create-vs-reuse, so
// what this preview shows is the literal truth of what conversion would
// do — not a second, hand-rolled approximation. Nothing is created or
// mutated here; the caller reviews the candidates, then calls the real
// POST .../convert with an explicit partyId/contactId to force reuse of
// a shown candidate, or omits them to accept convertCrmLead's own
// default (auto-reuse only an "exact" match, otherwise create new).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const lead = (await getCrmRecord(client, crmContext(session), "leads", id)) as Record<string, unknown>;
    // Sequential, not Promise.all: concurrent queries on one PoolClient can
    // interleave protocol messages (Postgres 08P01).
    const accountCandidates = await findAccountDuplicates(client, crmContext(session), {
        name: lead.companyName || lead.fullName || `${lead.firstName || ""} ${lead.lastName || ""}`.trim(),
      });
    const contactCandidates = await findContactDuplicates(client, crmContext(session), {
        email: lead.email,
        mobile: lead.mobile || lead.phone,
        firstName: lead.firstName,
        lastName: lead.lastName,
      });
    // Candidates the caller cannot open are shown only as restricted.
    const result = await {
      accountCandidates: projectDuplicateMatchesForCaller(crmContext(session), "account", accountCandidates),
      contactCandidates: projectDuplicateMatchesForCaller(crmContext(session), "contact", contactCandidates),
    };
    return ok(result);
  });
}
