import { notFound } from "next/navigation";
import CrmLeadDetailWorkspace from "@/modules/crm/components/lead-detail-workspace";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext } from "@/modules/crm";
import { getLeadDetailData } from "@/modules/crm/server/lead-detail-data";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) return notFound();
  const context = crmContext(session);
  let data;
  try {
    data = await tenantTransaction(context.organizationId, (client) =>
      getLeadDetailData(client, context, id),
    );
  } catch {
    return notFound();
  }
  const lead = data.lead as Record<string, unknown>;
  return (
    <CrmLeadDetailWorkspace
      lead={JSON.parse(JSON.stringify(lead))}
      activities={JSON.parse(JSON.stringify(data.activities))}
      communications={JSON.parse(JSON.stringify(data.communications))}
      notes={JSON.parse(JSON.stringify(data.notes))}
      scoreHistory={JSON.parse(JSON.stringify(data.scoreHistory))}
      opportunities={JSON.parse(JSON.stringify(data.opportunities))}
      duplicates={JSON.parse(JSON.stringify(data.duplicates))}
      options={JSON.parse(JSON.stringify(data.options))}
      attachments={JSON.parse(JSON.stringify(data.attachments))}
      selectedTags={JSON.parse(JSON.stringify(data.selectedTags))}
      assignmentHistory={JSON.parse(JSON.stringify(data.assignmentHistory))}
      qualification={JSON.parse(JSON.stringify(data.qualification))}
      lifecycleHistory={JSON.parse(JSON.stringify(data.lifecycleHistory))}
      provenance={JSON.parse(JSON.stringify(data.provenance))}
      consentEvents={JSON.parse(JSON.stringify(data.consentEvents))}
      enrichmentReviews={JSON.parse(JSON.stringify(data.enrichmentReviews))}
      slaCases={JSON.parse(JSON.stringify(data.slaCases))}
      slaEvents={JSON.parse(JSON.stringify(data.slaEvents))}
      dataQuality={JSON.parse(JSON.stringify(data.dataQuality))}
      aiPredictions={JSON.parse(JSON.stringify(data.aiPredictions))}
      canManage={hasPermission(session, PERMISSIONS.crmLeadsManage)}
      canManagePrivacy={hasPermission(session, PERMISSIONS.crmPrivacyManage)}
      canManageDataQuality={hasPermission(session, PERMISSIONS.crmDataQualityManage)}
      canAssignOwner={
        hasPermission(session, PERMISSIONS.crmLeadsManage) &&
        (hasPermission(session, PERMISSIONS.crmRecordsViewAll) ||
          session.roleSlugs.includes("organization_owner"))
      }
      canManageActivities={hasPermission(
        session,
        PERMISSIONS.crmActivitiesManage,
      )}
      canManageCommunications={hasPermission(
        session,
        PERMISSIONS.crmCommunicationsManage,
      )}
    />
  );
}
