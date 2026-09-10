// Capability-owned CRM route implementation. The Next.js route file is a thin adapter only.
import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, hasPermission, requirePermissionFromSession } from "@/core/authorization";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin, audit } from "@/core/security";

const VISIBILITIES = new Set(["private", "team", "organization"]);
const FILTER_KEYS = new Set([
  "status",
  "ownerId",
  "sourceId",
  "priority",
  "rating",
  "followup",
  "qualification",
]);
const COLUMN_KEYS = new Set([
  "code",
  "fullName",
  "companyName",
  "status",
  "priority",
  "rating",
  "ownerUserId",
  "score",
  "nextFollowUpAt",
  "updatedAt",
]);
const SORT_KEYS = new Set([
  "updatedAt",
  "createdAt",
  "score",
  "nextFollowUpAt",
  "priority",
  "rating",
  "fullName",
  "companyName",
]);

type Input = Record<string, unknown>;

function normalizeFilters(value: unknown, visibility: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const text = String(source[key] ?? "").trim().slice(0, 160);
    if (text) result[key] = text;
  }
  const search = String(source.search ?? "").trim();
  if (visibility === "private" && search) result.search = search.slice(0, 160);
  if (visibility !== "private" && search)
    throw new HttpError(
      400,
      "Shared Lead views cannot contain free-text search. Use structured filters instead.",
    );
  return result;
}

function normalizeColumns(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).filter((item) => COLUMN_KEYS.has(item)))].slice(0, 20);
}

function normalizeSort(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      field: String(item.field || ""),
      direction: String(item.direction || "desc").toLowerCase() === "asc" ? "asc" : "desc",
    }))
    .filter((item) => SORT_KEYS.has(item.field))
    .slice(0, 3);
}

function scopePredicate(context: Awaited<ReturnType<typeof crmApiContext>>, values: unknown[]) {
  let sql = "";
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    sql += ` AND (view.company_id IS NULL OR view.company_id=$${values.length})`;
  } else if (!context.allowAllCompanies) return " AND false";
  if (context.activeBranchId) {
    values.push(context.activeBranchId);
    sql += ` AND (view.branch_id IS NULL OR view.branch_id=$${values.length})`;
  } else if (!context.allowAllCompanies) return sql + " AND false";
  return sql;
}

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const views = await tenantTransaction(context.organizationId, async (client) => {
      const values: unknown[] = [context.organizationId, session.userId];
      const scope = scopePredicate(context, values);
      const result = await client.query(
        `SELECT view.id,view.name,view.filters,view.columns,view.sort,view.visibility,view.team_id,
                view.company_id,view.branch_id,view.user_id AS owner_user_id,view.created_at,view.updated_at,
                team.name AS team_name,
                CASE WHEN view.user_id=$2 THEN true ELSE false END AS can_delete
           FROM tenant.crm_lead_saved_views view
           LEFT JOIN tenant.crm_sales_teams team
             ON team.organization_id=view.organization_id AND team.id=view.team_id
          WHERE view.organization_id=$1${scope}
            AND (
              view.user_id=$2
              OR view.visibility='organization'
              OR (
                view.visibility='team'
                AND EXISTS (
                  SELECT 1 FROM tenant.crm_sales_team_members member
                   WHERE member.organization_id=view.organization_id
                     AND member.team_id=view.team_id
                     AND member.user_id=$2
                     AND member.status='active'
                     AND member.effective_from<=current_date
                     AND (member.effective_to IS NULL OR member.effective_to>=current_date)
                )
              )
            )
          ORDER BY CASE WHEN view.user_id=$2 THEN 0 ELSE 1 END,view.name,view.id`,
        values,
      );
      return result.rows;
    });
    return ok({ views });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const input = (await readJson(request)) as Input;
    const action = String(input.action || "save");

    const result = await tenantTransaction(context.organizationId, async (client) => {
      if (action === "delete") {
        const id = String(input.id || "");
        if (!id) throw new HttpError(400, "Saved-view ID is required.");
        const deleted = await client.query(
          `DELETE FROM tenant.crm_lead_saved_views
            WHERE organization_id=$1 AND user_id=$2 AND id=$3
            RETURNING id,name,visibility,team_id`,
          [context.organizationId, session.userId, id],
        );
        if (!deleted.rows[0]) throw new HttpError(404, "Saved view not found or is not owned by you.");
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.lead_saved_view.deleted",
          entityType: "crm_lead_saved_view",
          entityId: id,
          beforeData: deleted.rows[0],
          request,
          client,
        });
        return { deleted: id };
      }

      if (action !== "save") throw new HttpError(400, "Unsupported saved-view action.");
      const name = String(input.name || "").trim().slice(0, 120);
      if (!name) throw new HttpError(400, "Saved-view name is required.");
      const visibility = String(input.visibility || "private").toLowerCase();
      if (!VISIBILITIES.has(visibility)) throw new HttpError(400, "Saved-view visibility is invalid.");

      let teamId: string | null = null;
      if (visibility !== "private") {
        requirePermissionFromSession(session, PERMISSIONS.crmSavedViewsShare);
      }
      if (visibility === "organization" && !hasPermission(session, PERMISSIONS.crmRecordsViewAll)) {
        throw new HttpError(403, "Organization-shared views require permission to view all CRM records.");
      }
      if (visibility === "team") {
        teamId = String(input.teamId || "").trim();
        if (!teamId) throw new HttpError(400, "Select a sales team for a team-shared view.");
        const member = await client.query(
          `SELECT team.id,team.name,team.company_id,member.member_role
             FROM tenant.crm_sales_teams team
             JOIN tenant.crm_sales_team_members member
               ON member.organization_id=team.organization_id AND member.team_id=team.id
            WHERE team.organization_id=$1 AND team.id=$2 AND team.status='active'
              AND member.user_id=$3 AND member.status='active'
              AND member.effective_from<=current_date
              AND (member.effective_to IS NULL OR member.effective_to>=current_date)
              AND (team.manager_user_id=$3 OR member.member_role IN ('manager','sales_ops'))
            LIMIT 1`,
          [context.organizationId, teamId, session.userId],
        );
        if (!member.rows[0]) throw new HttpError(403, "You can share a view only with a sales team you manage.");
        if (context.activeCompanyId && member.rows[0].company_id && member.rows[0].company_id !== context.activeCompanyId)
          throw new HttpError(409, "The selected sales team belongs to another company.");
      }

      const filters = normalizeFilters(input.filters, visibility);
      const columns = normalizeColumns(input.columns);
      const sort = normalizeSort(input.sort);
      const saved = await client.query(
        `INSERT INTO tenant.crm_lead_saved_views(
           organization_id,user_id,name,filters,columns,sort,is_shared,visibility,team_id,company_id,branch_id,created_by,updated_by
         ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$2,$2)
         ON CONFLICT(organization_id,user_id,name)
         DO UPDATE SET filters=EXCLUDED.filters,columns=EXCLUDED.columns,sort=EXCLUDED.sort,
           is_shared=EXCLUDED.is_shared,visibility=EXCLUDED.visibility,team_id=EXCLUDED.team_id,
           company_id=EXCLUDED.company_id,branch_id=EXCLUDED.branch_id,updated_by=$2,updated_at=now()
         RETURNING *`,
        [
          context.organizationId,
          session.userId,
          name,
          JSON.stringify(filters),
          JSON.stringify(columns),
          JSON.stringify(sort),
          visibility !== "private",
          visibility,
          teamId,
          context.activeCompanyId || null,
          context.activeBranchId || null,
        ],
      );
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead_saved_view.saved",
        entityType: "crm_lead_saved_view",
        entityId: String(saved.rows[0].id),
        afterData: {
          name,
          visibility,
          teamId,
          companyId: context.activeCompanyId || null,
          branchId: context.activeBranchId || null,
          filters,
          columns,
          sort,
        },
        request,
        client,
      });
      return saved.rows[0];
    });
    return ok({ result }, action === "delete" ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
