import { Client } from "pg";

import { getAccountingWorld } from "./accounting-fixtures";
import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import type { SalesPersona } from "./sales-fixtures";

// Deterministic Assets E2E world: two users holding the REAL seeded `asset_manager` role (so one can register
// what the other capitalizes and approves), an ordinary `employee` with no asset permissions, and a category
// wired to the ledger accounts of an initialized Accounting foundation (the Accounting world is ensured first,
// idempotently, because every Assets financial event is handed to it).
const PASSWORD = "AssetE2E!2026Secure";

export type AssetsWorld = { organizationId: string; companyId: string; mgrA: SalesPersona; mgrB: SalesPersona; plain: SalesPersona; categoryName: string; suffix: string };

let worldPromise: Promise<AssetsWorld> | null = null;
export const getAssetsWorld = () => (worldPromise ??= buildWorld());

async function buildWorld(): Promise<AssetsWorld> {
  await getAccountingWorld();
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } = await import("../../../services/api/src/core/session.js");
  try {
    const owner = await client.query(`SELECT id FROM public.users WHERE email=$1`, [fixtures.ownerEmail]);
    const organizationId = (await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [owner.rows[0].id])).rows[0].organization_id as string;
    const companyId = (await client.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`, [organizationId])).rows[0].id as string;
    const branchId = (await client.query(`SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, companyId])).rows[0].id as string;
    const slugs = ["asset_manager", "employee"];
    const roles = await client.query(`SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug = ANY($2::text[])`, [organizationId, slugs]);
    const roleIdBySlug = Object.fromEntries(roles.rows.map((row) => [row.slug as string, row.id as string]));
    for (const slug of slugs) if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organisation ${organizationId}.`);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
    const account = async (code: string) => (await client.query(`SELECT a.id FROM tenant.accounting_accounts a JOIN tenant.accounting_ledgers l ON l.id=a.ledger_id WHERE a.organization_id=$1 AND a.company_id=$2 AND l.ledger_type='primary' AND a.code=$3`, [organizationId, companyId, code])).rows[0].id as string;
    const categoryName = `E2E Equipment ${suffix}`;
    await client.query(
      `INSERT INTO tenant.asset_categories(organization_id,company_id,code,name,useful_life_months,depreciation_method,asset_account_id,accumulated_depreciation_account_id,depreciation_expense_account_id,gain_loss_account_id,clearing_account_id,revaluation_reserve_account_id,impairment_loss_account_id,proceeds_account_id,created_by)
       VALUES($1,$2,$3,$4,12,'straight_line',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [organizationId, companyId, `E2E-${suffix}`.slice(0, 30), categoryName, await account("1500"), await account("1590"), await account("6300"), await account("4900"), await account("2900"), await account("3100"), await account("6500"), await account("1120"), owner.rows[0].id]);
    await client.query("COMMIT");

    const passwordHash = await hashPassword(PASSWORD);
    async function persona(label: string, roleSlug: string): Promise<SalesPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-asset-${label}-${suffix}@crm-e2e-fixture.test`.toLowerCase();
      await client.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`, [userId, email, `E2E Asset ${label}`, passwordHash]);
      await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, userId, roleIdBySlug[roleSlug]]);
      await client.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PASSWORD, userId };
    }
    return { organizationId, companyId, mgrA: await persona("a", "asset_manager"), mgrB: await persona("b", "asset_manager"), plain: await persona("plain", "employee"), categoryName, suffix };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
