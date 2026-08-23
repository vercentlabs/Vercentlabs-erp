import { notFound } from "next/navigation";
import { findCrmDuplicates, getCrmOptions, getCrmRecord } from "@vercentlabs/api";

import CrmLeadDetailWorkspace from "@/modules/crm/components/lead-detail-workspace";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  let data;
  try {
    data = await tenantTransaction(context.organizationId, async (client) => {
      const lead = await getCrmRecord(client, context, "leads", id);
      const [activities, communications, notes, scoreHistory, opportunities, duplicates, options] = await Promise.all([
        client.query(`SELECT a.*,u.full_name AS assigned_name FROM tenant.crm_activities a LEFT JOIN public.users u ON u.id=a.assigned_to WHERE a.organization_id=$1 AND a.entity_type='lead' AND a.entity_id=$2 ORDER BY COALESCE(a.completed_at,a.due_at,a.created_at) DESC LIMIT 200`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND lead_id=$2 ORDER BY occurred_at DESC LIMIT 200`, [context.organizationId, id]),
        client.query(`SELECT n.*,u.full_name AS author_name FROM tenant.crm_notes n LEFT JOIN public.users u ON u.id=n.created_by WHERE n.organization_id=$1 AND n.entity_type='lead' AND n.entity_id=$2 ORDER BY is_pinned DESC,created_at DESC LIMIT 200`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_lead_score_history WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 200`, [context.organizationId, id]),
        client.query(`SELECT * FROM tenant.crm_opportunities WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 100`, [context.organizationId, id]),
        findCrmDuplicates(client, context, lead, id),
        getCrmOptions(client, context),
      ]);
      return { lead, activities: activities.rows, communications: communications.rows, notes: notes.rows, scoreHistory: scoreHistory.rows, opportunities: opportunities.rows, duplicates, options };
    });
  } catch { return notFound(); }
  const lead = data.lead as Record<string, unknown>;
return <CrmLeadDetailWorkspace
    lead={JSON.parse(JSON.stringify(lead))}
    activities={JSON.parse(JSON.stringify(data.activities))}
    communications={JSON.parse(JSON.stringify(data.communications))}
    notes={JSON.parse(JSON.stringify(data.notes))}
    scoreHistory={JSON.parse(JSON.stringify(data.scoreHistory))}
    opportunities={JSON.parse(JSON.stringify(data.opportunities))}
    duplicates={JSON.parse(JSON.stringify(data.duplicates))}
    options={JSON.parse(JSON.stringify(data.options))}
    canManage={hasPermission(session, PERMISSIONS.crmLeadsManage)}
    canManageActivities={hasPermission(session, PERMISSIONS.crmActivitiesManage)}
    canManageCommunications={hasPermission(session, PERMISSIONS.crmCommunicationsManage)}
  />;
}
