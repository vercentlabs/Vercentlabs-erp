// Simple CRM access for small teams (CRM plan 5.7): three levels — Salesperson (their own records), Sales manager (their teams'
// records, assignment and the pipeline's settings) and CRM administrator (everything in CRM, its settings and integrations) — set per
// member on one screen, instead of composing roles by hand. Each level is the matching CRM role template (crm_salesperson,
// crm_sales_manager, crm_administrator); a member keeps every other role they have (Sales, Accounting…), so a Sales role's CRM access
// stays alongside. Changing the level goes through the ordinary role assignment, with its checks and audit.
import { setUserRoles } from "../../../core/access/administration-service.js";
import { CrmError } from "../data-management/errors.js";

export const CRM_ACCESS_LEVELS = Object.freeze([
  { key: "none", label: "No CRM role", slug: null, description: "No CRM role of its own (a Sales role may still give CRM access)." },
  { key: "salesperson", label: "Salesperson", slug: "crm_salesperson", description: "Their own leads, deals, companies, contacts, tasks and follow-ups." },
  { key: "manager", label: "Sales manager", slug: "crm_sales_manager", description: "Their teams' records, assignment and the pipeline's settings." },
  { key: "admin", label: "CRM administrator", slug: "crm_administrator", description: "Everything in CRM: settings, integrations, imports and automation." },
]);
const LEVEL_SLUGS = CRM_ACCESS_LEVELS.filter((level) => level.slug).map((level) => level.slug);

function requireAssign(session) {
  if (session.roleSlugs?.includes("organization_owner") || session.permissions?.includes("roles.assign")) return;
  throw new CrmError(403, "You do not have permission to change people's access.", "PERMISSION_DENIED");
}

async function levelRoles(client, organizationId) {
  const { rows } = await client.query("SELECT id, slug, name FROM roles WHERE organization_id = $1 AND status = 'active' AND slug = ANY($2::text[])", [organizationId, LEVEL_SLUGS]);
  return new Map(rows.map((row) => [row.slug, row]));
}

// Every active member with their CRM level and their other roles.
export async function listCrmAccess(client, session) {
  requireAssign(session);
  const roles = await levelRoles(client, session.organizationId);
  const { rows } = await client.query(
    `SELECT member.user_id, account.full_name, account.email,
            COALESCE(array_agg(role.slug) FILTER (WHERE role.slug IS NOT NULL), ARRAY[]::text[]) AS slugs,
            COALESCE(array_agg(role.name) FILTER (WHERE role.slug IS NOT NULL AND NOT (role.slug = ANY($2::text[]))), ARRAY[]::text[]) AS other_roles
       FROM organization_memberships member JOIN users account ON account.id = member.user_id
       LEFT JOIN user_role_assignments assignment ON assignment.organization_id = member.organization_id AND assignment.user_id = member.user_id AND assignment.status = 'active'
       LEFT JOIN roles role ON role.id = assignment.role_id AND role.status = 'active'
      WHERE member.organization_id = $1 AND member.status = 'active'
      GROUP BY member.user_id, account.full_name, account.email ORDER BY lower(account.full_name)`, [session.organizationId, LEVEL_SLUGS]);
  return {
    levels: CRM_ACCESS_LEVELS.map(({ key, label, description }) => ({ key, label, description, available: key === "none" || roles.has(CRM_ACCESS_LEVELS.find((level) => level.key === key).slug) })),
    members: rows.map((row) => {
      const level = [...CRM_ACCESS_LEVELS].reverse().find((entry) => entry.slug && row.slugs.includes(entry.slug));
      return { userId: row.user_id, name: row.full_name, email: row.email, level: level?.key ?? "none", isOwner: row.slugs.includes("organization_owner"), otherRoles: row.other_roles };
    }),
  };
}

// Gives a member a CRM level (removing the other two). The organization's owner keeps full access whatever the level.
export async function setCrmAccessLevel(client, session, userId, levelKey) {
  requireAssign(session);
  const level = CRM_ACCESS_LEVELS.find((entry) => entry.key === levelKey);
  if (!level) throw new CrmError(400, "Choose a CRM level.", "CRM_ACCESS_LEVEL_INVALID");
  const roles = await levelRoles(client, session.organizationId);
  if (level.slug && !roles.has(level.slug)) throw new CrmError(409, `The ${level.label} role is not set up in this organization.`, "CRM_ACCESS_LEVEL_UNAVAILABLE");
  const current = (await client.query(
    `SELECT assignment.role_id, assignment.is_primary, role.slug FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2 AND assignment.status = 'active'`, [session.organizationId, userId])).rows;
  if (current.some((row) => row.slug === "organization_owner")) throw new CrmError(409, "The organization's owner has full access already.", "CRM_ACCESS_LEVEL_OWNER");
  const kept = current.filter((row) => !LEVEL_SLUGS.includes(row.slug));
  const roleIds = [...kept.map((row) => row.role_id), ...(level.slug ? [roles.get(level.slug).id] : [])];
  if (!roleIds.length) throw new CrmError(409, "Everyone keeps at least one role: give them another role first, or choose a CRM level.", "CRM_ACCESS_LEVEL_LAST_ROLE");
  const primary = kept.find((row) => row.is_primary)?.role_id ?? roleIds[roleIds.length - 1];
  await setUserRoles(client, session, { targetUserId: userId, roleIds, primaryRoleId: primary, acknowledgeWarningConflicts: true });
  return (await listCrmAccess(client, session)).members.find((member) => member.userId === userId);
}
