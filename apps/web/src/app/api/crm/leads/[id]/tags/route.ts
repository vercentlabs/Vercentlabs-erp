import { getCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as { tagIds?: unknown };
    if (!Array.isArray(input.tagIds) || input.tagIds.length > 50) throw new HttpError(400, "Choose up to 50 tags.", "CRM_LEAD_TAGS_INVALID");
    const tagIds = [...new Set(input.tagIds.map(String).filter(Boolean))];
    tagIds.forEach(assertCrmIdentifier);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);

    const tags = await tenantTransaction(context.organizationId, async (client) => {
      await getCrmRecord(client, context, "leads", id);
      if (tagIds.length) {
        const allowed = await client.query(
          `SELECT id FROM tenant.crm_tags WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[])`,
          [context.organizationId, tagIds],
        );
        if (allowed.rowCount !== tagIds.length) throw new HttpError(400, "One or more tags are unavailable.", "CRM_LEAD_TAGS_INVALID");
      }
      const before = await client.query(`SELECT tag_id FROM tenant.crm_lead_tags WHERE organization_id=$1 AND lead_id=$2`, [context.organizationId, id]);
      await client.query(`DELETE FROM tenant.crm_lead_tags WHERE organization_id=$1 AND lead_id=$2`, [context.organizationId, id]);
      for (const tagId of tagIds) {
        await client.query(
          `INSERT INTO tenant.crm_lead_tags(organization_id,lead_id,tag_id,created_by) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
          [context.organizationId, id, tagId, session.userId],
        );
      }
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.tags_updated",
        entityType: "lead",
        entityId: id,
        beforeData: { tagIds: before.rows.map((row) => row.tag_id) },
        afterData: { tagIds },
        request,
        client,
      });
      const result = await client.query(
        `SELECT t.id,t.name,t.color FROM tenant.crm_lead_tags lt JOIN tenant.crm_tags t ON t.organization_id=lt.organization_id AND t.id=lt.tag_id WHERE lt.organization_id=$1 AND lt.lead_id=$2 ORDER BY t.name`,
        [context.organizationId, id],
      );
      return result.rows;
    });
    return ok({ message: "Lead tags updated.", tags });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
