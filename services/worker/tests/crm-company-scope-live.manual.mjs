#!/usr/bin/env node
// MANUAL, live-PostgreSQL-only test — *.manual.mjs so it is not matched by
// services/worker's own `test` script glob (tests/*.test.mjs), same
// precedent as live-concurrency.manual.mjs and
// crm-auth-context-live.manual.mjs. Lives here for dependency reasons
// only (pg + @vercentlabs/database + @vercentlabs/api are all real deps
// of this package) — what it verifies is unrelated to the worker.
//
// Proves the fix for a real reported bug: a lead created while the
// company switcher is set to Company A was visible while switched to
// Company B and vice versa, for organization_owner/system_administrator
// accounts. Root cause: recordScope() (and getCrmDashboard/getCrmReport's
// own copies of the same company-visibility logic) treated
// allowAllCompanies as "skip company filtering unconditionally" instead
// of "only skip it when no company is actively selected at all." Fixed
// in services/api/src/modules/crm/index.js.
//
// Run manually: node services/worker/tests/crm-company-scope-live.manual.mjs
// Requires DATABASE_URL pointed at a real Postgres with all migrations
// applied. Creates its own organization/companies/user/leads and deletes
// them all in a finally block regardless of outcome.
import pg from "pg";
import { setTenantContext } from "@vercentlabs/database";
import { listCrmRecords, getCrmDashboard } from "@vercentlabs/api";

const { Pool } = pg;
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://vercent_app:replace_with_runtime_password@localhost:5433/vercentlabs_control";

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`OK   ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

function uuid() {
  return crypto.randomUUID();
}

function ownerContext({ organizationId, activeCompanyId }) {
  return {
    organizationId,
    userId: null,
    activeCompanyId,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [],
    roleSlugs: ["organization_owner"],
  };
}

async function withTenant(pool, organizationId, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, organizationId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
  const created = { users: [], organizations: [], companies: [] };

  try {
    const bootstrapUser = uuid();
    await pool.query(
      `INSERT INTO public.users (id, email, full_name, password_hash) VALUES ($1,$2,$3,'x')`,
      [bootstrapUser, `p-company-scope-${bootstrapUser}@example.invalid`, "Bootstrap"],
    );
    created.users.push(bootstrapUser);

    const orgId = uuid();
    await pool.query(
      `INSERT INTO public.organizations (id, name, slug, country_code, timezone, base_currency, created_by)
       VALUES ($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`,
      [orgId, `Company-scope test org ${orgId}`, `company-scope-test-${orgId}`, bootstrapUser],
    );
    created.organizations.push(orgId);

    const companyA = uuid();
    const companyB = uuid();
    for (const [id, code] of [[companyA, "A"], [companyB, "B"]]) {
      await pool.query(
        `INSERT INTO public.companies (id, organization_id, name, legal_name, country_code, base_currency, code)
         VALUES ($1,$2,$3,$3,'IN','INR',$4)`,
        [id, orgId, `Company ${code}`, `CO-${code}-${id.slice(0, 8)}`],
      );
      created.companies.push(id);
    }

    const leadA = uuid();
    const leadB = uuid();
    await withTenant(pool, orgId, async (client) => {
      await client.query(
        `INSERT INTO tenant.crm_leads (id, organization_id, company_id, code, first_name)
         VALUES ($1,$2,$3,'CS-A','Alpha')`,
        [leadA, orgId, companyA],
      );
      await client.query(
        `INSERT INTO tenant.crm_leads (id, organization_id, company_id, code, first_name)
         VALUES ($1,$2,$3,'CS-B','Beta')`,
        [leadB, orgId, companyB],
      );
    });

    // --- The exact reported bug: owner switched to Company A ---
    await withTenant(pool, orgId, async (client) => {
      const ctx = ownerContext({ organizationId: orgId, activeCompanyId: companyA });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(rows.some((r) => r.id === leadA), "owner switched to Company A sees Company A's lead");
      check(!rows.some((r) => r.id === leadB), "owner switched to Company A does NOT see Company B's lead (this was the reported bug)");

      const dashboard = await getCrmDashboard(client, ctx);
      check(dashboard.metrics.openLeads === 1, `owner's Company-A dashboard shows exactly 1 open lead (got ${dashboard.metrics.openLeads})`);
    });

    // --- Switch to Company B ---
    await withTenant(pool, orgId, async (client) => {
      const ctx = ownerContext({ organizationId: orgId, activeCompanyId: companyB });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(rows.some((r) => r.id === leadB), "owner switched to Company B sees Company B's lead");
      check(!rows.some((r) => r.id === leadA), "owner switched to Company B does NOT see Company A's lead");

      const dashboard = await getCrmDashboard(client, ctx);
      check(dashboard.metrics.openLeads === 1, `owner's Company-B dashboard shows exactly 1 open lead (got ${dashboard.metrics.openLeads})`);
    });

    // --- No company selected at all: genuine cross-company view preserved ---
    await withTenant(pool, orgId, async (client) => {
      const ctx = ownerContext({ organizationId: orgId, activeCompanyId: null });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 50 });
      check(
        rows.some((r) => r.id === leadA) && rows.some((r) => r.id === leadB),
        "owner with NO company selected still sees both companies' leads (allowAllCompanies fallback preserved)",
      );
    });

    // --- Direct-ID access also respects the active company now ---
    await withTenant(pool, orgId, async (client) => {
      const ctx = ownerContext({ organizationId: orgId, activeCompanyId: companyA });
      const { rows } = await listCrmRecords(client, ctx, "leads", { limit: 1, offset: 0 });
      void rows;
      let threw = false;
      try {
        const { getCrmRecord } = await import("@vercentlabs/api");
        await getCrmRecord(client, ctx, "leads", leadB);
      } catch (error) {
        threw = error?.status === 404;
      }
      check(threw, "owner switched to Company A gets 404 on direct-ID access to Company B's lead");
    });
  } finally {
    for (const organizationId of created.organizations) {
      await withTenant(pool, organizationId, async (client) => {
        await client.query("DELETE FROM tenant.crm_leads WHERE organization_id = $1", [organizationId]);
      }).catch(() => {});
      for (const companyId of created.companies) {
        await pool.query("DELETE FROM public.companies WHERE id = $1", [companyId]).catch(() => {});
      }
      await pool.query("DELETE FROM public.organizations WHERE id = $1", [organizationId]).catch(() => {});
    }
    for (const userId of created.users) {
      await pool.query("DELETE FROM public.users WHERE id = $1", [userId]).catch(() => {});
    }
    await pool.end();
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
