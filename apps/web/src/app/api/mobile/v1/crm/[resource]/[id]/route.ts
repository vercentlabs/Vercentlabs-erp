import { archiveCrmRecord, findCrmDuplicates, getCrmRecord, updateCrmRecord } from "@vercentlabs/api";
import type { CrmResourceKey } from "@vercentlabs/shared-types";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier, requireCrmManage, requireCrmResourceView } from "@/modules/crm/api";
import { crmApiContext, isCrmDefinition, rethrowCrmError } from "@/modules/crm";
import { crmPatchSchemas } from "@/modules/crm/validation";
import { tenantTransaction } from "@/core/db";
import { HttpError, readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { requireMobileSession } from "@/core/mobile-session";
import { audit } from "@/core/security";

function valid(resource: string): asserts resource is CrmResourceKey {
  if (!isCrmDefinition(resource)) throw new HttpError(404, "Unknown CRM resource.");
}

export async function GET(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource); assertCrmIdentifier(id); requireCrmResourceView(session, resource);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => {
      const record = await getCrmRecord(client, context, resource, id);
      if (resource === "leads") {
        const [activities, communications, notes, scoreHistory, opportunities] = await Promise.all([
          client.query(`SELECT a.*,u.full_name AS assigned_name FROM tenant.crm_activities a LEFT JOIN public.users u ON u.id=a.assigned_to WHERE a.organization_id=$1 AND a.entity_type='lead' AND a.entity_id=$2 ORDER BY COALESCE(a.completed_at,a.due_at,a.created_at) DESC LIMIT 100`, [context.organizationId, id]),
          client.query(`SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND lead_id=$2 ORDER BY occurred_at DESC LIMIT 100`, [context.organizationId, id]),
          client.query(`SELECT n.*,u.full_name AS author_name FROM tenant.crm_notes n LEFT JOIN public.users u ON u.id=n.created_by WHERE n.organization_id=$1 AND n.entity_type='lead' AND n.entity_id=$2 ORDER BY is_pinned DESC,created_at DESC`, [context.organizationId, id]),
          client.query(`SELECT * FROM tenant.crm_lead_score_history WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC`, [context.organizationId, id]),
          client.query(`SELECT * FROM tenant.crm_opportunities WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC`, [context.organizationId, id]),
        ]);
        const duplicates = await findCrmDuplicates(client, context, record, id);
        return { record, related: { activities: activities.rows, communications: communications.rows, notes: notes.rows, scoreHistory: scoreHistory.rows, opportunities: opportunities.rows, duplicates } };
      }
      if (resource === "opportunities") {
        const [history, activities, communications, items, competitors] = await Promise.all([
          client.query(`SELECT h.*,fs.name AS from_stage,ts.name AS to_stage,u.full_name AS changed_by_name FROM tenant.crm_opportunity_stage_history h LEFT JOIN tenant.crm_pipeline_stages fs ON fs.id=h.from_stage_id LEFT JOIN tenant.crm_pipeline_stages ts ON ts.id=h.to_stage_id LEFT JOIN public.users u ON u.id=h.changed_by WHERE h.organization_id=$1 AND h.opportunity_id=$2 ORDER BY h.changed_at DESC`, [context.organizationId, id]),
          client.query(`SELECT * FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='opportunity' AND entity_id=$2 ORDER BY COALESCE(due_at,created_at) DESC`, [context.organizationId, id]),
          client.query(`SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND opportunity_id=$2 ORDER BY occurred_at DESC`, [context.organizationId, id]),
          client.query(`SELECT oi.*,i.name AS item_name FROM tenant.crm_opportunity_items oi JOIN tenant.items i ON i.id=oi.item_id WHERE oi.organization_id=$1 AND oi.opportunity_id=$2 ORDER BY oi.created_at`, [context.organizationId, id]),
          client.query(`SELECT c.* FROM tenant.crm_opportunity_competitors oc JOIN tenant.crm_competitors c ON c.id=oc.competitor_id WHERE oc.organization_id=$1 AND oc.opportunity_id=$2`, [context.organizationId, id]),
        ]);
        return { record, related: { history: history.rows, activities: activities.rows, communications: communications.rows, items: items.rows, competitors: competitors.rows } };
      }
      return { record, related: {} };
    });
    return mobileOk(request, result);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function PATCH(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource); assertCrmIdentifier(id); requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId!);
    const input = await crmPatchSchemas[resource].parseAsync(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) => withMobileIdempotency(client, session, request, input, async () => {
      const record = await updateCrmRecord(client, context, resource, id, input);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `crm.${resource}.updated`, entityType: resource, entityId: id, afterData: input, request, client });
      return { message: "CRM record updated.", record };
    }));
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function DELETE(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource); assertCrmIdentifier(id); requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId!);
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, { archive: true }, async () => {
        const record = await archiveCrmRecord(client, context, resource, id);
        await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `crm.${resource}.archived`, entityType: resource, entityId: id, afterData: record, request, client });
        return { message: "CRM record archived.", record };
      }),
    );
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
