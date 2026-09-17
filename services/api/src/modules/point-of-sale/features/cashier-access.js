// F270/F271 -- cashier eligibility administration. Reuses the platform's
// own organization_memberships/user_role_assignments tables to find real,
// active, POS-role-holding members (never a fabricated/arbitrary UUID),
// and grants/revokes store eligibility through tenant.pos_store_access
// (migration 115) -- the same table assertPosStoreAccess() (features/
// cart.js) already enforces against. There is no separate POS-only
// identity or role system here: "who can act as a cashier at all" is
// still governed entirely by the platform's roles/permissions (pos_cashier/
// pos_supervisor/pos_manager, or any custom role holding a pos.* grant);
// this file only answers "at which store(s)."
import { requireCompanyRecord } from "../../../core/references.js";

function posError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requirePermission(context, permission) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

// Active org members who hold at least one point-of-sale-module role --
// candidates an administrator can actually assign to a store. Mirrors the
// exact "currently active role assignment" shape services/api/src/core/
// session.js's resolveSessionContext() uses for real authorization
// (status='active', within starts_at/expires_at, role.status='active'),
// not an ad hoc approximation.
export async function listPosEligibleCashiers(client, context) {
  requirePermission(context, "pos.store.manage");
  const result = await client.query(
    `SELECT u.id, u.full_name, u.email,
            coalesce(array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL), ARRAY[]::text[]) AS role_slugs,
            coalesce(array_agg(DISTINCT psa.store_id) FILTER (WHERE psa.store_id IS NOT NULL), ARRAY[]::uuid[]) AS assigned_store_ids
       FROM public.organization_memberships om
       JOIN public.users u ON u.id = om.user_id
       LEFT JOIN public.user_role_assignments ura
         ON ura.organization_id = om.organization_id AND ura.user_id = om.user_id
        AND ura.status = 'active' AND ura.starts_at <= now() AND (ura.expires_at IS NULL OR ura.expires_at > now())
       LEFT JOIN public.roles r
         ON r.id = ura.role_id AND r.organization_id = om.organization_id AND r.status = 'active' AND r.module_key = 'point-of-sale'
       LEFT JOIN tenant.pos_store_access psa
         ON psa.organization_id = om.organization_id AND psa.user_id = om.user_id AND psa.company_id = $2
      WHERE om.organization_id = $1 AND om.status = 'active' AND u.status = 'active'
      GROUP BY u.id, u.full_name, u.email
     HAVING count(r.id) > 0
      ORDER BY u.full_name`,
    [context.organizationId, context.companyId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    roleSlugs: row.role_slugs,
    assignedStoreIds: row.assigned_store_ids,
  }));
}

export async function listPosStoreAccess(client, context, storeId) {
  requirePermission(context, "pos.store.manage");
  const result = await client.query(
    `SELECT psa.id, psa.user_id, psa.store_id, psa.created_at, u.full_name, u.email
       FROM tenant.pos_store_access psa
       JOIN public.users u ON u.id = psa.user_id
      WHERE psa.organization_id = $1 AND psa.company_id = $2 AND ($3::uuid IS NULL OR psa.store_id = $3)
      ORDER BY u.full_name`,
    [context.organizationId, context.companyId, storeId || null],
  );
  return result.rows.map((row) => ({ id: row.id, userId: row.user_id, storeId: row.store_id, fullName: row.full_name, email: row.email, createdAt: row.created_at }));
}

export async function grantPosStoreAccess(client, context, input) {
  requirePermission(context, "pos.store.manage");
  if (!input.userId || !input.storeId) throw posError(400, "A user and a store are required.", "POS_STORE_ACCESS_INPUT_INVALID");
  const member = await client.query(`SELECT 1 FROM public.organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active'`, [
    context.organizationId,
    input.userId,
  ]);
  if (!member.rows[0]) throw posError(404, "That user is not an active member of this organization.", "POS_STORE_ACCESS_USER_INVALID");
  await requireCompanyRecord(client, context, "pos_store", input.storeId);
  await client.query(
    `INSERT INTO tenant.pos_store_access (organization_id,company_id,user_id,store_id,created_by)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id,user_id,store_id) DO NOTHING`,
    [context.organizationId, context.companyId, input.userId, input.storeId, context.userId],
  );
  const row = await client.query(`SELECT * FROM tenant.pos_store_access WHERE organization_id=$1 AND user_id=$2 AND store_id=$3`, [
    context.organizationId,
    input.userId,
    input.storeId,
  ]);
  return row.rows[0];
}

export async function revokePosStoreAccess(client, context, input) {
  requirePermission(context, "pos.store.manage");
  const result = await client.query(`DELETE FROM tenant.pos_store_access WHERE organization_id=$1 AND user_id=$2 AND store_id=$3 RETURNING id`, [
    context.organizationId,
    input.userId,
    input.storeId,
  ]);
  if (!result.rows[0]) throw posError(404, "That cashier is not assigned to this store.", "POS_STORE_ACCESS_NOT_FOUND");
  return { revoked: true };
}
