import {
  getLeadAssignmentFallback,
  listLeadAssigneeAvailability,
  listLeadAssignmentPolicies,
} from "@vercentlabs/api";
import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { crmContext } from "@/modules/crm";
import LeadAssignmentRulesWorkspace from "@/modules/crm/components/lead-assignment-rules-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead assignment rules" };

export default async function LeadAssignmentRulesPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmSettingsManage)) return notFound();
  const context = crmContext(session);
  const data = await tenantTransaction(
    context.organizationId,
    async (client) => {
      const [policies, sources, fallback, availability] = await Promise.all([
        listLeadAssignmentPolicies(client, context),
        client.query(
          `SELECT id,name FROM tenant.crm_lead_sources WHERE organization_id=$1 AND status='active' ORDER BY is_default DESC,sort_order,name`,
          [context.organizationId],
        ),
        getLeadAssignmentFallback(client, context),
        listLeadAssigneeAvailability(client, context),
      ]);
      return {
        policies: policies.filter((policy) =>
          ["fixed", "round_robin"].includes(String(policy.mode)),
        ),
        sources: sources.rows,
        fallback,
        availability,
      };
    },
  );
  return (
    <LeadAssignmentRulesWorkspace
      policies={JSON.parse(JSON.stringify(data.policies))}
      sources={JSON.parse(JSON.stringify(data.sources))}
      fallback={JSON.parse(JSON.stringify(data.fallback))}
      availability={JSON.parse(JSON.stringify(data.availability))}
    />
  );
}
