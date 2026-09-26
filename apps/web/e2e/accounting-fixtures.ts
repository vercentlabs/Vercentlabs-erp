import { expect, type Page } from "@playwright/test";
import { Client } from "pg";

import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import type { SalesPersona } from "./sales-fixtures";

// Deterministic Accounting E2E world: users holding the REAL seeded roles -- an `accountant` (prepares
// journals and invoices, has NO approval authority), a `finance_manager` (approves and posts), and an
// ordinary `employee` with no accounting permissions. The ledger foundation (chart of accounts, journals,
// mappings, settings), an open fiscal period, numbering series and a customer are ensured for the shared
// organisation, idempotently.
const PASSWORD = "AcctE2E!2026Secure";

export type AccountingWorld = { organizationId: string; companyId: string; accountant: SalesPersona; finance: SalesPersona; plain: SalesPersona; customerName: string; suffix: string };

let worldPromise: Promise<AccountingWorld> | null = null;
export const getAccountingWorld = () => (worldPromise ??= buildWorld());

async function buildWorld(): Promise<AccountingWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } = await import("../../../services/api/src/core/session.js");
  // @ts-expect-error -- plain JS domain module without a declaration file; called with the documented shape
  const { initializeAccountingCompany } = await import("../../../services/api/src/modules/accounting/foundation.js");
  try {
    const owner = await client.query(`SELECT id FROM public.users WHERE email=$1`, [fixtures.ownerEmail]);
    const organizationId = (await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [owner.rows[0].id])).rows[0].organization_id as string;
    const company = (await client.query(`SELECT id,base_currency FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`, [organizationId])).rows[0];
    const companyId = company.id as string;
    const branchId = (await client.query(`SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, companyId])).rows[0].id as string;
    const slugs = ["accountant", "finance_manager", "employee"];
    const roles = await client.query(`SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug = ANY($2::text[])`, [organizationId, slugs]);
    const roleIdBySlug = Object.fromEntries(roles.rows.map((row) => [row.slug as string, row.id as string]));
    for (const slug of slugs) if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organisation ${organizationId}.`);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
    await client.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,$2::text,$2::text,2,true,'active') ON CONFLICT DO NOTHING`, [organizationId, company.base_currency]);
    const year = new Date().getUTCFullYear();
    const overlap = await client.query(`SELECT 1 FROM tenant.fiscal_periods WHERE organization_id=$1 AND company_id=$2 AND status='open' AND start_date<=current_date AND end_date>=current_date`, [organizationId, companyId]);
    if (!overlap.rows[0]) {
      await client.query(`INSERT INTO tenant.fiscal_periods(organization_id,company_id,name,fiscal_year,start_date,end_date,status) VALUES ($1,$2,$3,$4,$5,$6,'open')`, [organizationId, companyId, `E2E ${suffix}`, `E2E-${suffix}`, `${year}-01-01`, `${year}-12-31`]);
    }
    await initializeAccountingCompany(client, { organizationId, companyId, userId: owner.rows[0].id });
    const customerName = `E2E Customer ${suffix}`;
    await client.query(`INSERT INTO tenant.business_parties(organization_id,company_id,code,party_type,display_name,currency_code,created_by,updated_by) VALUES ($1,$2,$3,'customer',$4,$5,$6,$6)`, [organizationId, companyId, `E2EC-${suffix}`.slice(0, 30), customerName, company.base_currency, owner.rows[0].id]);
    await client.query("COMMIT");

    const passwordHash = await hashPassword(PASSWORD);
    async function persona(label: string, roleSlug: string): Promise<SalesPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-acct-${label}-${suffix}@crm-e2e-fixture.test`.toLowerCase();
      await client.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`, [userId, email, `E2E Acct ${label}`, passwordHash]);
      await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, userId, roleIdBySlug[roleSlug]]);
      await client.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PASSWORD, userId };
    }
    return { organizationId, companyId, accountant: await persona("acc", "accountant"), finance: await persona("fin", "finance_manager"), plain: await persona("plain", "employee"), customerName, suffix };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function open(page: Page, path: string, heading: string | RegExp) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 180_000 });
}
