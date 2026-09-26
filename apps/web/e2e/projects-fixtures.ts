import { Client } from "pg";

import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import type { SalesPersona } from "./sales-fixtures";

// Deterministic Projects E2E world: two users holding the REAL seeded `project_manager` role (so one can create
// what the other approves) and an ordinary `employee` with no project permissions.
const PASSWORD = "ProjE2E!2026Secure";

export type ProjectsWorld = { organizationId: string; companyId: string; mgrA: SalesPersona; mgrB: SalesPersona; plain: SalesPersona; suffix: string };

let worldPromise: Promise<ProjectsWorld> | null = null;
export const getProjectsWorld = () => (worldPromise ??= buildWorld());

async function buildWorld(): Promise<ProjectsWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } = await import("../../../services/api/src/core/auth/session.js");
  try {
    const owner = await client.query(`SELECT id FROM public.users WHERE email=$1`, [fixtures.ownerEmail]);
    const organizationId = (await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [owner.rows[0].id])).rows[0].organization_id as string;
    const companyId = (await client.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`, [organizationId])).rows[0].id as string;
    const branchId = (await client.query(`SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, companyId])).rows[0].id as string;
    const slugs = ["project_manager", "employee"];
    const roles = await client.query(`SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug = ANY($2::text[])`, [organizationId, slugs]);
    const roleIdBySlug = Object.fromEntries(roles.rows.map((row) => [row.slug as string, row.id as string]));
    for (const slug of slugs) if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organisation ${organizationId}.`);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const passwordHash = await hashPassword(PASSWORD);
    async function persona(label: string, roleSlug: string): Promise<SalesPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-proj-${label}-${suffix}@crm-e2e-fixture.test`.toLowerCase();
      await client.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`, [userId, email, `E2E Proj ${label}`, passwordHash]);
      await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, userId, roleIdBySlug[roleSlug]]);
      await client.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PASSWORD, userId };
    }
    return { organizationId, companyId, mgrA: await persona("a", "project_manager"), mgrB: await persona("b", "project_manager"), plain: await persona("plain", "employee"), suffix };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
