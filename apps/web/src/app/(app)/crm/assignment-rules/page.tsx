import {
  getLeadAssignmentFallback,
  listLeadAssigneeAvailability,
  listLeadAssignmentPolicies,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmApiContext } from "@/modules/crm";
import LeadAssignmentRulesWorkspace from "@/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-assignment-rules-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead assignment rules" };

export default async function LeadAssignmentRulesPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmSettingsManage)) return notFound();
  const context = await crmApiContext(session);
  const data = await tenantTransaction(
    context.organizationId,
    async (client) => {
      const [policies, sources, territories, fallback, availability] = await Promise.all([
        listLeadAssignmentPolicies(client, context),
        client.query(
          `SELECT id,name FROM tenant.crm_lead_sources WHERE organization_id=$1 AND status='active' ORDER BY is_default DESC,sort_order,name`,
          [context.organizationId],
        ),
        client.query(
          `SELECT id,name FROM tenant.crm_territories WHERE organization_id=$1 AND status='active' ORDER BY name`,
          [context.organizationId],
        ),
        getLeadAssignmentFallback(client, context),
        listLeadAssigneeAvailability(client, context),
      ]);
      // F005 Prompt 4: territory/workload modes are governed CRM-CAP-002
      // configuration — every active mode is shown, not just fixed/round_robin.
      return {
        policies,
        sources: sources.rows,
        territories: territories.rows,
        fallback,
        availability,
      };
    },
  );
  return (
    <LeadAssignmentRulesWorkspace
      policies={JSON.parse(JSON.stringify(data.policies))}
      sources={JSON.parse(JSON.stringify(data.sources))}
      territories={JSON.parse(JSON.stringify(data.territories))}
      fallback={JSON.parse(JSON.stringify(data.fallback))}
      availability={JSON.parse(JSON.stringify(data.availability))}
    />
  );
}
