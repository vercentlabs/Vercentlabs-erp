import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { Client } from "pg";

import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";

// CRM MVP world (Leads, Accounts, Contacts, assignment, qualification,
// lifecycle, duplicates, conversion) inside the shared E2E organisation, with
// people holding the REAL built-in roles — nobody is the organisation owner:
//   rep        sales_representative  works own Leads, Accounts, Contacts
//   rep2       sales_representative  a second seller (assignment target)
//   manager    sales_manager         the sellers' manager
//   admin      crm_administrator     settings and data quality (duplicates)
//   marketing  marketing_manager     manages Leads, cannot create Accounts or Opportunities
// Created once per run with a unique suffix; nothing pre-existing is changed.
const PASSWORD = "CrmMvpE2E!2026Secure";

export type CrmPersona = {
  email: string;
  password: string;
  userId: string;
  name: string;
};
export type CrmWorld = {
  organizationId: string;
  suffix: string;
  rep: CrmPersona;
  rep2: CrmPersona;
  manager: CrmPersona;
  admin: CrmPersona;
  marketing: CrmPersona;
};

let worldPromise: Promise<CrmWorld> | undefined;
export const getCrmWorld = () => (worldPromise ??= buildCrmWorld());

export async function withCrmDb<T>(
  organizationId: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_organization_id', $1, true)`,
      [organizationId],
    );
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function buildCrmWorld(): Promise<CrmWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } =
    await import("../../../services/api/src/core/auth/session.js");
  try {
    const owner = await client.query(
      `SELECT id FROM public.users WHERE email=$1`,
      [fixtures.ownerEmail],
    );
    const ownerUserId = owner.rows[0].id as string;
    const organizationId = (
      await client.query(
        `SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`,
        [ownerUserId],
      )
    ).rows[0].organization_id as string;
    const companyId = (
      await client.query(
        `SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`,
        [organizationId],
      )
    ).rows[0].id as string;
    const branchId = (
      await client.query(
        `SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`,
        [organizationId, companyId],
      )
    ).rows[0].id as string;
    const slugs = [
      "sales_representative",
      "sales_manager",
      "crm_administrator",
      "marketing_manager",
    ];
    const roles = await client.query(
      `SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug = ANY($2::text[])`,
      [organizationId, slugs],
    );
    const roleIdBySlug = Object.fromEntries(
      roles.rows.map((row) => [row.slug as string, row.id as string]),
    );
    for (const slug of slugs)
      if (!roleIdBySlug[slug])
        throw new Error(
          `Role '${slug}' not found in organisation ${organizationId}.`,
        );

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const passwordHash = await hashPassword(PASSWORD);
    async function createPersona(
      label: string,
      roleSlug: string,
    ): Promise<CrmPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-crm-${label}-${suffix}@crm-e2e-fixture.test`;
      const name = `CRM ${label[0].toUpperCase()}${label.slice(1)} ${suffix}`;
      await client.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`,
        [userId, email, name, passwordHash],
      );
      await client.query(
        `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`,
        [organizationId, userId],
      );
      await client.query(
        `INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`,
        [organizationId, userId, roleIdBySlug[roleSlug]],
      );
      await client.query(
        `INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`,
        [organizationId, userId, companyId],
      );
      await client.query(
        `INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`,
        [organizationId, userId, branchId],
      );
      return { email, password: PASSWORD, userId, name };
    }
    const rep = await createPersona("rep", "sales_representative");
    const rep2 = await createPersona("seller", "sales_representative");
    const manager = await createPersona("manager", "sales_manager");
    const admin = await createPersona("admin", "crm_administrator");
    const marketing = await createPersona("marketing", "marketing_manager");
    // The manager manages a real Sales Team with both sellers in it: that team
    // (not a role name) is what lets a manager see and reassign their Leads.
    await client.query("BEGIN");
    await client.query(
      `SELECT set_config('app.current_organization_id', $1, true)`,
      [organizationId],
    );
    const team = await client.query(
      `INSERT INTO tenant.crm_sales_teams(organization_id,company_id,code,name,manager_user_id,status,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,'active',$6,$6) RETURNING id`,
      [
        organizationId,
        companyId,
        `MVP-${suffix}`.toUpperCase(),
        `MVP Team ${suffix}`,
        manager.userId,
        ownerUserId,
      ],
    );
    for (const member of [rep, rep2])
      await client.query(
        `INSERT INTO tenant.crm_sales_team_members(organization_id,company_id,team_id,user_id,member_role,status,created_by,updated_by) VALUES ($1,$2,$3,$4,'seller','active',$5,$5)`,
        [
          organizationId,
          companyId,
          team.rows[0].id,
          member.userId,
          ownerUserId,
        ],
      );
    await client.query("COMMIT");
    return { organizationId, suffix, rep, rep2, manager, admin, marketing };
  } finally {
    await client.end();
  }
}

// Sign-in is rate limited: each persona signs in through the real form once per
// process and later contexts reuse its session.
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext["storageState"]>>
>();

export async function openCrmSession(
  browser: Browser,
  persona: CrmPersona,
): Promise<{ context: BrowserContext; page: Page }> {
  const saved = sessions.get(persona.email);
  if (saved) {
    const context = await browser.newContext({ storageState: saved });
    return { context, page: await context.newPage() };
  }
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel(/email/i).fill(persona.email);
  await page.getByLabel(/password/i).fill(persona.password);
  const [login] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/login")),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
  expect(login.status(), "CRM persona sign-in must succeed").toBe(200);
  sessions.set(persona.email, await context.storageState());
  return { context, page };
}
