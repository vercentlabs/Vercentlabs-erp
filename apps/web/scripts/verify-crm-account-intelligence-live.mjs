import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";
import {
  CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS,
  executePrivacyRequest,
  findAccountDuplicates,
  findContactDuplicates,
  getAccountHierarchy,
  getCrmAccountIntelligenceReadiness,
  getCustomer360,
  mergeAccountsGoverned,
  mergeContactsGoverned,
  recordCrmAccountIntelligenceAcceptance,
  recordCustomerServiceEvent,
  runPrivacyRetention,
  setAccountParent,
} from "@vercentlabs/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const unique = `CRM02-${Date.now()}`;
try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["029_crm_account_intelligence_privacy.sql"],
  );
  assert.ok(migration.rows[0], "CRM-02 tenant migration is not applied.");
  const baseline = (
    await client.query(
      `SELECT organization.id AS organization_id,organization.created_by AS user_id,company.id AS company_id,organization.base_currency
       FROM public.organizations organization
       JOIN public.companies company ON company.organization_id=organization.id
       WHERE organization.status='active' AND organization.created_by IS NOT NULL
       ORDER BY organization.created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    baseline?.organization_id && baseline?.user_id && baseline?.company_id,
    "An active organisation, owner and company are required.",
  );
  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [baseline.organization_id],
  );
  baseline.ledger_id =
    (
      await client.query(
        `SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 ORDER BY created_at LIMIT 1`,
        [baseline.organization_id],
      )
    ).rows[0]?.id || null;
  const context = {
    organizationId: baseline.organization_id,
    userId: baseline.user_id,
    activeCompanyId: baseline.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [
      "crm.view",
      "crm.accounts.manage",
      "crm.privacy.manage",
      "crm.reports.view",
    ],
    roleSlugs: ["organization_owner"],
  };
  const createAccount = async (code, displayName, legalName = displayName) =>
    (
      await client.query(
        `INSERT INTO tenant.business_parties(
         organization_id,company_id,code,party_type,display_name,legal_name,currency_code,status,created_by,updated_by
       ) VALUES($1,$2,$3,'customer',$4,$5,$6,'active',$7,$7) RETURNING *`,
        [
          baseline.organization_id,
          baseline.company_id,
          code,
          displayName,
          legalName,
          baseline.base_currency || "INR",
          baseline.user_id,
        ],
      )
    ).rows[0];
  const parent = await createAccount(`${unique}-P`, `${unique} Holdings`);
  const child = await createAccount(`${unique}-C`, `${unique} Operations`);
  const duplicate = await createAccount(
    `${unique}-D`,
    `${unique} Duplicate`,
    `${unique} Operations`,
  );
  await setAccountParent(
    client,
    context,
    child.id,
    parent.id,
    "CRM-02 live hierarchy",
  );
  const hierarchy = await getAccountHierarchy(client, context, child.id);
  assert.equal(hierarchy.ancestors[0].id, parent.id);
  await assert.rejects(
    () => setAccountParent(client, context, parent.id, child.id, "cycle test"),
    /cycle/i,
  );
  await assert.rejects(
    () =>
      mergeAccountsGoverned(
        client,
        context,
        parent.id,
        child.id,
        "descendant merge test",
      ),
    /descendant/i,
  );

  const survivorContact = (
    await client.query(
      `INSERT INTO tenant.contacts(organization_id,party_id,first_name,last_name,email,is_primary,status,created_by,updated_by)
       VALUES($1,$2,'Asha','Buyer',$3,true,'active',$4,$4) RETURNING *`,
      [
        baseline.organization_id,
        child.id,
        `${unique.toLowerCase()}@example.test`,
        baseline.user_id,
      ],
    )
  ).rows[0];
  const sourceContact = (
    await client.query(
      `INSERT INTO tenant.contacts(organization_id,party_id,first_name,last_name,email,is_primary,status,created_by,updated_by)
       VALUES($1,$2,'Asha','Buyer',$3,false,'active',$4,$4) RETURNING *`,
      [
        baseline.organization_id,
        child.id,
        `${unique.toLowerCase()}@example.test`,
        baseline.user_id,
      ],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO tenant.crm_activities(organization_id,company_id,entity_type,entity_id,activity_type,subject,status,created_by,updated_by)
     VALUES($1,$2,'party',$3,'note',$4,'completed',$5,$5)`,
    [
      baseline.organization_id,
      baseline.company_id,
      child.id,
      `${unique} customer activity`,
      baseline.user_id,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_communications(organization_id,channel,direction,party_id,contact_id,provider,subject,status,created_by,updated_by)
     VALUES($1,'email','outbound',$2,$3,'manual',$4,'sent',$5,$5)`,
    [
      baseline.organization_id,
      child.id,
      sourceContact.id,
      `${unique} communication`,
      baseline.user_id,
    ],
  );
  await recordCustomerServiceEvent(client, context, child.id, {
    externalSystem: "crm02-live",
    externalCaseId: unique,
    eventType: "case_opened",
    title: `${unique} support case`,
    status: "open",
  });
  await client.query(
    `INSERT INTO tenant.sales_quotations(organization_id,company_id,quotation_number,party_id,contact_id,owner_user_id,valid_until,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,current_date+30,$6,$6)`,
    [
      baseline.organization_id,
      baseline.company_id,
      `${unique}-Q`,
      child.id,
      survivorContact.id,
      baseline.user_id,
    ],
  );
  await client.query(
    `INSERT INTO tenant.sales_orders(organization_id,company_id,sales_order_number,party_id,contact_id,owner_user_id,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$6,$6)`,
    [
      baseline.organization_id,
      baseline.company_id,
      `${unique}-SO`,
      child.id,
      survivorContact.id,
      baseline.user_id,
    ],
  );
  if (baseline.ledger_id) {
    await client.query(
      `INSERT INTO tenant.accounting_customer_invoices(
         organization_id,company_id,ledger_id,invoice_number,party_id,invoice_date,accounting_date,due_date,currency_code,functional_currency_code,
         grand_total,base_currency_total,outstanding_amount,status,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,current_date,current_date,current_date+30,$6,$6,100,100,100,'posted',$7,$7)`,
      [
        baseline.organization_id,
        baseline.company_id,
        baseline.ledger_id,
        `${unique}-INV`,
        child.id,
        baseline.base_currency || "INR",
        baseline.user_id,
      ],
    );
  }
  const customer360 = await getCustomer360(client, context, child.id);
  const entryTypes = new Set(
    customer360.timeline.map((entry) => entry.entry_type),
  );
  for (const type of [
    "activity",
    "communication",
    "quotation",
    "sales_order",
    "support",
  ])
    assert.ok(entryTypes.has(type), `Customer 360 is missing ${type}.`);
  if (baseline.ledger_id) assert.ok(entryTypes.has("invoice"));

  const accountDuplicates = await findAccountDuplicates(client, context, {
    legalName: `${unique} Operations`,
    excludeId: child.id,
  });
  assert.ok(accountDuplicates.some((row) => row.id === duplicate.id));
  await client.query(
    `INSERT INTO tenant.sales_quotations(organization_id,company_id,quotation_number,party_id,owner_user_id,valid_until,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,current_date+30,$5,$5)`,
    [
      baseline.organization_id,
      baseline.company_id,
      `${unique}-Q-DUP`,
      duplicate.id,
      baseline.user_id,
    ],
  );
  const accountMerge = await mergeAccountsGoverned(
    client,
    context,
    duplicate.id,
    child.id,
    "CRM-02 live account merge",
  );
  assert.ok(accountMerge.id);
  assert.equal(
    (
      await client.query(
        `SELECT party_id FROM tenant.sales_quotations WHERE organization_id=$1 AND quotation_number=$2`,
        [baseline.organization_id, `${unique}-Q-DUP`],
      )
    ).rows[0].party_id,
    child.id,
  );

  const contactDuplicates = await findContactDuplicates(client, context, {
    email: `${unique.toLowerCase()}@example.test`,
    excludeId: survivorContact.id,
  });
  assert.ok(contactDuplicates.some((row) => row.id === sourceContact.id));
  const contactMerge = await mergeContactsGoverned(
    client,
    context,
    sourceContact.id,
    survivorContact.id,
    "CRM-02 live contact merge",
  );
  assert.ok(contactMerge.id);
  assert.equal(
    (
      await client.query(
        `SELECT contact_id FROM tenant.crm_communications WHERE organization_id=$1 AND subject=$2`,
        [baseline.organization_id, `${unique} communication`],
      )
    ).rows[0].contact_id,
    survivorContact.id,
  );

  const lead = (
    await client.query(
      `INSERT INTO tenant.crm_leads(organization_id,company_id,code,first_name,email,status,retention_until,created_by,updated_by)
       VALUES($1,$2,$3,'Privacy Person',$4,'archived',now()-interval '1 day',$5,$5) RETURNING *`,
      [
        baseline.organization_id,
        baseline.company_id,
        `${unique}-L`,
        `${unique.toLowerCase()}-privacy@example.test`,
        baseline.user_id,
      ],
    )
  ).rows[0];
  const privacy = (
    await client.query(
      `INSERT INTO tenant.crm_privacy_requests(
         organization_id,company_id,request_type,subject_type,subject_id,requester_name,requester_email,identity_verified_at,due_at,status,created_by,updated_by
       ) VALUES($1,$2,'deletion','lead',$3,'Privacy Person',$4,now(),now()+interval '7 days','in_progress',$5,$5) RETURNING *`,
      [
        baseline.organization_id,
        baseline.company_id,
        lead.id,
        `${unique.toLowerCase()}-privacy@example.test`,
        baseline.user_id,
      ],
    )
  ).rows[0];
  const privacyExecution = await executePrivacyRequest(
    client,
    context,
    privacy.id,
    { erasureMode: "erase" },
  );
  assert.equal(privacyExecution.run.operation, "erase");
  const erasedLead = (
    await client.query(
      `SELECT first_name,email,privacy_status FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
      [baseline.organization_id, lead.id],
    )
  ).rows[0];
  assert.equal(erasedLead.email, null);
  assert.equal(erasedLead.privacy_status, "erased");

  const retentionLead = (
    await client.query(
      `INSERT INTO tenant.crm_leads(organization_id,company_id,code,first_name,email,status,retention_until,created_by,updated_by)
       VALUES($1,$2,$3,'Retention Person',$4,'archived',now()-interval '1 day',$5,$5) RETURNING *`,
      [
        baseline.organization_id,
        baseline.company_id,
        `${unique}-RL`,
        `${unique.toLowerCase()}-retention@example.test`,
        baseline.user_id,
      ],
    )
  ).rows[0];
  await client.query(
    `UPDATE tenant.crm_privacy_retention_policies SET status='active',retention_days=1,action='anonymize',updated_by=$1 WHERE organization_id=$2 AND subject_type='lead'`,
    [baseline.user_id, baseline.organization_id],
  );
  const retention = await runPrivacyRetention(client, context, { limit: 10 });
  assert.ok(Number(retention.processed) >= 1);
  assert.equal(
    (
      await client.query(
        `SELECT privacy_status FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
        [baseline.organization_id, retentionLead.id],
      )
    ).rows[0].privacy_status,
    "anonymized",
  );

  for (const capabilityId of CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS) {
    await recordCrmAccountIntelligenceAcceptance(client, context, {
      capabilityId,
      status: "passed",
      commitSha: "crm-02-live-verification",
      evidence: {
        transactional: true,
        verifiedBy: "crm-02-live",
        capabilityId,
      },
    });
  }
  const readiness = await getCrmAccountIntelligenceReadiness(client, context);
  assert.equal(readiness.readiness, "ready");
  assert.equal(readiness.score, 100);
  const acceptanceRow = (
    await client.query(
      `SELECT id FROM tenant.crm_account_intelligence_acceptance_runs WHERE organization_id=$1 ORDER BY recorded_at DESC LIMIT 1`,
      [baseline.organization_id],
    )
  ).rows[0];
  await client.query("SAVEPOINT immutable_acceptance_check");
  await assert.rejects(
    () =>
      client.query(
        `UPDATE tenant.crm_account_intelligence_acceptance_runs SET status='failed' WHERE organization_id=$1 AND id=$2`,
        [baseline.organization_id, acceptanceRow.id],
      ),
    /immutable/i,
  );
  await client.query("ROLLBACK TO SAVEPOINT immutable_acceptance_check");
  await client.query("RELEASE SAVEPOINT immutable_acceptance_check");

  const protectedTables = [
    "crm_account_hierarchy_events",
    "crm_entity_merge_aliases",
    "crm_customer_service_events",
    "crm_privacy_retention_policies",
    "crm_privacy_execution_runs",
    "crm_account_intelligence_acceptance_runs",
  ];
  const security = await client.query(
    `SELECT relation.relname,relation.relrowsecurity,relation.relforcerowsecurity,
            EXISTS(SELECT 1 FROM pg_policy policy WHERE policy.polrelid=relation.oid) AS has_policy
     FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname='tenant' AND relation.relname=ANY($1::text[])`,
    [protectedTables],
  );
  assert.equal(security.rows.length, protectedTables.length);
  for (const row of security.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.equal(row.has_policy, true);
  }
  await client.query("ROLLBACK");
  console.log(
    "CRM-02 live verification passed: hierarchy cycle protection, Customer 360 across CRM/Sales/Accounting/support ingestion, governed account/contact merges, anonymisation and erasure, automated retention, immutable acceptance evidence and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
