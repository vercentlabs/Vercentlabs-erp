import { notFound } from "next/navigation";
import { listLeadStages } from "@vercentlabs/api";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { getLeadDetailData } from "@/modules/crm/prospect-and-relationship-master-data/lead-detail-data";
import { tenantTransaction } from "@/core/db";
import { LeadDetailView } from "./LeadDetailView";

// UI 2.0 golden reference for Record 360 (docs/ux/UI_REWRITE_TRACKER.md
// Phase 4) -- mounted alongside the existing, real /crm/leads/[id] full
// workspace (CrmLeadDetailWorkspace) rather than replacing it: that
// component covers SLA cases, consent events, enrichment reviews, AI
// predictions and every mutation action, none of which this first pass
// re-implements. This page reuses the exact same real data source
// (getLeadDetailData) to present the primary read surfaces (identity,
// overview, activity, sales context, governance) through the new design
// system; "Open full workspace" links to the real page for anything this
// preview doesn't yet cover or any action that mutates data.
export const dynamic = "force-dynamic";

export default async function LeadNextDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = await crmApiContext(session);

  let data;
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const detail = await getLeadDetailData(client, context, id);
      const stages = await listLeadStages(client, context);
      return { detail, stages };
    });
  } catch {
    notFound();
  }

  return (
    <LeadDetailView
      lead={JSON.parse(JSON.stringify(data.detail.lead))}
      activities={JSON.parse(JSON.stringify(data.detail.activities))}
      communications={JSON.parse(JSON.stringify(data.detail.communications))}
      notes={JSON.parse(JSON.stringify(data.detail.notes))}
      opportunities={JSON.parse(JSON.stringify(data.detail.opportunities))}
      duplicates={JSON.parse(JSON.stringify(data.detail.duplicates))}
      selectedTags={JSON.parse(JSON.stringify(data.detail.selectedTags))}
      assignmentHistory={JSON.parse(JSON.stringify(data.detail.assignmentHistory))}
      lifecycleHistory={JSON.parse(JSON.stringify(data.detail.lifecycleHistory))}
      qualification={JSON.parse(JSON.stringify(data.detail.qualification))}
      stages={JSON.parse(JSON.stringify(data.stages.rows || []))}
      canManage={hasPermission(session, PERMISSIONS.crmLeadsManage)}
    />
  );
}
