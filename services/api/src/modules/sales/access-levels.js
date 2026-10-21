// Simple Sales access for small teams (Sales audit, should-have): one plain level per person — Salesperson (their own quotations and orders),
// Billing (invoices, credit notes, payments), Dispatch (stock aside, deliveries, challans, returns) or Sales manager (everyone's documents,
// approvals and settings) — instead of composing 131 permissions. Each level is a Sales role template; a person keeps every other role they
// have (CRM, Accounting…). Changing the level goes through the ordinary role assignment, with its checks and audit.
import { setUserRoles } from "../../core/access/administration-service.js";
import { SalesError } from "./index.js";

export const SALES_ACCESS_LEVELS = Object.freeze([
  { key: "none", label: "No Sales role", slug: null, description: "No Sales role of its own (another role may still give Sales access)." },
  { key: "salesperson", label: "Salesperson", slug: "sales_representative", description: "Their own customers, quotations and orders; asks for invoices and deliveries." },
  { key: "billing", label: "Billing", slug: "sales_billing", description: "Invoices, credit notes and customer payments; sees customer balances." },
  { key: "dispatch", label: "Dispatch", slug: "sales_dispatch", description: "Keeps stock aside, dispatches and delivers, challans and e-way bills, receives returns." },
  { key: "manager", label: "Sales manager", slug: "sales_manager", description: "Everyone's documents, approvals, credit release, prices and Sales settings." },
]);
const LEVEL_SLUGS = SALES_ACCESS_LEVELS.filter((level) => level.slug).map((level) => level.slug);

function requireAssign(session) {
  if (session.roleSlugs?.includes("organization_owner") || session.permissions?.includes("roles.assign")) return;
  throw new SalesError(403, "You do not have permission to change people's access.", "PERMISSION_DENIED");
}

async function levelRoles(client, organizationId) {
  const { rows } = await client.query("SELECT id, slug, name FROM roles WHERE organization_id = $1 AND status = 'active' AND slug = ANY($2::text[])", [organizationId, LEVEL_SLUGS]);
  return new Map(rows.map((row) => [row.slug, row]));
}

// Every active member with their Sales level and their other roles.
export async function listSalesAccess(client, session) {
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
    levels: SALES_ACCESS_LEVELS.map(({ key, label, description, slug }) => ({ key, label, description, available: !slug || roles.has(slug) })),
    members: rows.map((row) => {
      // The highest level held (a manager who is also billing reads as manager).
      const level = [...SALES_ACCESS_LEVELS].reverse().find((entry) => entry.slug && row.slugs.includes(entry.slug));
      return { userId: row.user_id, name: row.full_name, email: row.email, level: level?.key ?? "none", isOwner: row.slugs.includes("organization_owner"), otherRoles: row.other_roles };
    }),
  };
}

// Gives a member a Sales level (removing the other Sales levels). The organization's owner keeps full access whatever the level.
export async function setSalesAccessLevel(client, session, userId, levelKey) {
  requireAssign(session);
  const level = SALES_ACCESS_LEVELS.find((entry) => entry.key === levelKey);
  if (!level) throw new SalesError(400, "Choose a Sales level.", "SALES_ACCESS_LEVEL_INVALID");
  const roles = await levelRoles(client, session.organizationId);
  if (level.slug && !roles.has(level.slug)) throw new SalesError(409, `The ${level.label} role is not set up in this organization.`, "SALES_ACCESS_LEVEL_UNAVAILABLE");
  const current = (await client.query(
    `SELECT assignment.role_id, assignment.is_primary, role.slug FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2 AND assignment.status = 'active'`, [session.organizationId, userId])).rows;
  if (current.some((row) => row.slug === "organization_owner")) throw new SalesError(409, "The organization's owner has full access already.", "SALES_ACCESS_LEVEL_OWNER");
  const kept = current.filter((row) => !LEVEL_SLUGS.includes(row.slug));
  const roleIds = [...kept.map((row) => row.role_id), ...(level.slug ? [roles.get(level.slug).id] : [])];
  if (!roleIds.length) throw new SalesError(409, "Everyone keeps at least one role: give them another role first, or choose a Sales level.", "SALES_ACCESS_LEVEL_LAST_ROLE");
  const primary = kept.find((row) => row.is_primary)?.role_id ?? roleIds[roleIds.length - 1];
  await setUserRoles(client, session, { targetUserId: userId, roleIds, primaryRoleId: primary, acknowledgeWarningConflicts: true });
  return (await listSalesAccess(client, session)).members.find((member) => member.userId === userId);
}
