import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const views = await tenantTransaction(context.organizationId, async (client) => {
      const result = await client.query(
        `SELECT id,name,filters,columns,sort,is_shared,created_at,updated_at
           FROM tenant.crm_lead_saved_views
          WHERE organization_id=$1 AND user_id=$2 ORDER BY name`,
        [context.organizationId, session.userId],
      );
      return result.rows;
    });
    return ok({ views });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Record<string, unknown>;
    const action = String(input.action || "save");
    const result = await tenantTransaction(context.organizationId, async (client) => {
      if (action === "delete") {
        const id = String(input.id || "");
        if (!id) throw new HttpError(400, "Saved-view ID is required.");
        const deleted = await client.query(
          `DELETE FROM tenant.crm_lead_saved_views
            WHERE organization_id=$1 AND user_id=$2 AND id=$3 RETURNING id`,
          [context.organizationId, session.userId, id],
        );
        if (!deleted.rows[0]) throw new HttpError(404, "Saved view not found.");
        return { deleted: id };
      }
      const name = String(input.name || "").trim().slice(0, 120);
      if (!name) throw new HttpError(400, "Saved-view name is required.");
      const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
      const saved = await client.query(
        `INSERT INTO tenant.crm_lead_saved_views(
           organization_id,user_id,name,filters,columns,sort,is_shared,created_by,updated_by
         ) VALUES($1,$2,$3,$4::jsonb,'[]'::jsonb,'[]'::jsonb,false,$2,$2)
         ON CONFLICT(organization_id,user_id,name)
         DO UPDATE SET filters=excluded.filters,updated_by=$2,updated_at=now()
         RETURNING *`,
        [context.organizationId, session.userId, name, JSON.stringify(filters)],
      );
      return saved.rows[0];
    });
    return ok({ result }, action === "delete" ? 200 : 201);
  } catch (error) { return errorResponse(error); }
}
