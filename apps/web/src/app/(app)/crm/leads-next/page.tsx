import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCrmOptions, listCrmRecords, listLeadStages } from "@vercentlabs/api";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { canViewCrmResource } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { enrichLeadOwnerIdentity } from "@/modules/crm/prospect-and-relationship-master-data/lead-owner-data";
import { tenantTransaction } from "@/core/db";
import { LeadsListView } from "./LeadsListView";

// UI 2.0 golden reference for the CRM Leads List (docs/ux/UI_REWRITE_TRACKER.md
// Phase 4). Deliberately mounted at a NEW path rather than replacing
// /crm/leads: CrmResourceManager's own client-side navigation
// (leadModeUrl/navigate in resource-manager.tsx) hardcodes `router.push`/
// `router.replace` to the literal string "/crm/leads" for search,
// pagination, create, edit and view-drawer flows. Adding a static
// crm/leads/page.tsx would take Next.js route-matching precedence over
// crm/[resource]/page.tsx for EVERY one of those real, working,
// permission-audited flows -- not just the initial page load -- silently
// breaking the mature, real leads workflow this session was explicitly
// told not to break. This page reuses the exact same real backend calls
// (listCrmRecords, getCrmOptions, enrichLeadOwnerIdentity, listLeadStages)
// so its data is real and permission-correct; mutation actions (create/
// edit/assign/etc.) link out to the existing verified /crm/leads and
// /crm/leads/[id] flows rather than re-implementing those domain commands
// here, per the "do not bypass CRM domain commands" / "do not break the
// CRM backend" constraints. See UI_REWRITE_TRACKER.md for the cutover plan.
export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;

export const metadata: Metadata = { title: "Leads" };

export default async function LeadsNextPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; sourceId?: string; ownerId?: string; page?: string }>;
}) {
  const query = await searchParams;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView) || !canViewCrmResource(session, "leads")) notFound();
  const context = await crmApiContext(session);
  const canManage = hasPermission(session, PERMISSIONS.crmLeadsManage);
  const canAssignOwner =
    hasPermission(session, PERMISSIONS.crmRecordsViewAll) || session.roleSlugs.includes("organization_owner");

  const search = String(query.search || "").trim().slice(0, 200);
  const status = String(query.status || "").trim().slice(0, 80);
  const sourceId = String(query.sourceId || "").trim().slice(0, 80);
  const ownerId = String(query.ownerId || "").trim().slice(0, 80);
  const page = Math.min(1_000_000, Math.max(1, Math.trunc(Number(query.page) || 1)));

  const { records, options, stages } = await tenantTransaction(context.organizationId, async (client) => {
    const records = await listCrmRecords(client, context, "leads", {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      search,
      status,
      sourceId,
      ownerId,
    });
    records.rows = await enrichLeadOwnerIdentity(client, context.organizationId, records.rows);
    const [options, stages] = await Promise.all([getCrmOptions(client, context), listLeadStages(client, context)]);
    return { records, options, stages };
  });

  return (
    <LeadsListView
      rows={JSON.parse(JSON.stringify(records.rows))}
      total={records.total}
      page={page}
      pageSize={PAGE_SIZE}
      search={search}
      status={status}
      sourceId={sourceId}
      ownerId={ownerId}
      sources={JSON.parse(JSON.stringify(options.sources || []))}
      owners={JSON.parse(JSON.stringify(options.users || []))}
      stages={JSON.parse(JSON.stringify(stages.rows || []))}
      canManage={canManage}
      canAssignOwner={canAssignOwner}
    />
  );
}
