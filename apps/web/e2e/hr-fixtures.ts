import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Client } from "pg";

import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import type { SalesPersona } from "./sales-fixtures";
import { BASE_URL } from "./base-url";

// Deterministic HR & Payroll E2E world: separate users holding the REAL seeded roles -- hr_manager
// x2 (so a second person can approve what the first prepared) and an ordinary `employee` who has no
// HR permissions at all and is linked to an employee record (employee self-service). Everything is
// created with a unique suffix inside the shared organisation.
const PASSWORD = "HrE2E!2026Secure";

export type HrWorld = {
  organizationId: string;
  companyId: string;
  branchId: string;
  hrA: SalesPersona;
  hrB: SalesPersona;
  ess: SalesPersona;
  plain: SalesPersona;
  suffix: string;
};

let worldPromise: Promise<HrWorld> | null = null;
export const getHrWorld = () => (worldPromise ??= buildWorld());

async function buildWorld(): Promise<HrWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } = await import("../../../services/api/src/core/auth/session.js");
  try {
    const owner = await client.query(`SELECT id FROM public.users WHERE email=$1`, [fixtures.ownerEmail]);
    const organizationId = (await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [owner.rows[0].id])).rows[0].organization_id as string;
    const companyId = (await client.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`, [organizationId])).rows[0].id as string;
    const branchId = (await client.query(`SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, companyId])).rows[0].id as string;
    const slugs = ["hr_manager", "employee"];
    const roles = await client.query(`SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug = ANY($2::text[])`, [organizationId, slugs]);
    const roleIdBySlug = Object.fromEntries(roles.rows.map((row) => [row.slug as string, row.id as string]));
    for (const slug of slugs) if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organisation ${organizationId}.`);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const passwordHash = await hashPassword(PASSWORD);
    async function persona(label: string, roleSlug: string): Promise<SalesPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-hr-${label}-${suffix}@crm-e2e-fixture.test`.toLowerCase();
      await client.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`, [userId, email, `E2E HR ${label}`, passwordHash]);
      await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, userId, roleIdBySlug[roleSlug]]);
      await client.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PASSWORD, userId };
    }
    const hrA = await persona("a", "hr_manager");
    const hrB = await persona("b", "hr_manager");
    const ess = await persona("ess", "employee");
    const plain = await persona("plain", "employee");
    return { organizationId, companyId, branchId, hrA, hrB, ess, plain, suffix };
  } finally {
    await client.end();
  }
}

// Direct database access for setup a real user could not do through the screens (linking a user to
// an employee record is an admin step; a backdated date puts a rule in reach).
export async function withDb<T>(world: HrWorld, fn: (q: (sql: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [world.organizationId]);
    const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

const origin = () => new URL(BASE_URL).origin;
export async function api<T>(context: BrowserContext, method: "GET" | "POST", path: string, data?: unknown, expectOk = true): Promise<{ status: number; body: T }> {
  const response = await context.request.fetch(`${origin()}/api/hr${path}`, { method, data, headers: { Origin: origin(), "Content-Type": "application/json" } });
  const text = await response.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    // A non-JSON reply is a server error page; say which call and what it said instead of a JSON syntax error.
    throw new Error(`${method} ${path} answered ${response.status()} with a non-JSON body: ${text.replace(/<[^>]+>/g, " ").replace(/s+/g, " ").slice(0, 400)}`);
  }
  if (expectOk) expect(response.ok(), `${method} ${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return { status: response.status(), body };
}
export type Rec = { record: { id: string } & Record<string, unknown> };

// Pick an option from a dropdown that may already be open, retrying while the list loads.
export async function pick(page: Page, trigger: Locator, option: RegExp | string) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible()) && (await trigger.count()) === 0) return;
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}
export async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 180_000 });
}

// An employee record inserted directly (joining is exercised by hr-workforce.spec.ts): active,
// optionally linked to a user and a manager.
export async function insertEmployee(world: HrWorld, number: string, first: string, last: string, opts: { userId?: string | null; managerId?: string | null; joiningDate?: string } = {}) {
  return withDb(world, async (q) => {
    const rows = await q(
      `INSERT INTO tenant.hr_employees(organization_id,company_id,employee_number,first_name,last_name,employment_type,joining_date,status,user_id,manager_employee_id,created_by) VALUES ($1,$2,$3,$4,$5,'permanent',$6,'active',$7,$8,$9) RETURNING id`,
      [world.organizationId, world.companyId, number, first, last, opts.joiningDate ?? "2025-01-06", opts.userId ?? null, opts.managerId ?? null, world.hrA.userId],
    );
    return String(rows[0].id);
  });
}

// A page an HR-less user must be refused: the permission state, not a heading, is what shows.
export async function openDenied(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/You don't have access to HR/).first()).toBeVisible({ timeout: 180_000 });
}
