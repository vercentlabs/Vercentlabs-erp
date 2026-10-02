#!/usr/bin/env node
// Marketing demo organisation for product screenshots on the public website.
//
// Creates "Northstar Demo Company" — an obviously fictional business — in a
// LOCAL database, using the ERP's own governed service functions (the same
// ones the HTTP routes call). Every visible person, company, product and
// address is synthetic; emails use the reserved example.com domain and phone
// numbers are left empty.
//
// Safety:
//  - Refuses anything but a localhost database (MIGRATION_DATABASE_URL) and
//    refuses NODE_ENV=production.
//  - Writes only to the database. No email, webhook, payment-gateway or
//    lead-capture call is made: the governed functions only write rows, and
//    any outbox rows stay unsent because no worker runs against this seed.
//  - Resumable: a re-run reuses the demo organisation and only fills in
//    sections that are still empty, so an interrupted seed can be completed.
//    To rebuild from nothing, reset the local database (pnpm db:setup).
//
// Usage (from the repository root, with the local database running):
//   node scripts/qa/seed-marketing-demo-org.mjs
// Then capture: apps/landing/scripts/capture-marketing-screenshots.mjs
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";

import * as api from "../../services/api/src/index.js";
import { hashPassword } from "../../services/api/src/core/auth/session.js";
import { setTenantContext } from "../../packages/database/src/index.js";
import { permissionsForRole } from "../../packages/permissions/src/roles.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false, quiet: true });
}

if (process.env.NODE_ENV === "production") throw new Error("Refusing to run with NODE_ENV=production.");
const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(connectionString)) throw new Error("Refusing to run against a non-local database.");

export const DEMO = Object.freeze({
  organizationName: "Northstar Demo",
  companyName: "Northstar Demo Company",
  companyCode: "NDC",
  branchName: "Demo Head Office",
  branchCode: "DEMO-HQ",
  ownerName: "Demo Admin",
  ownerEmail: "demo-admin@example.com",
  approverName: "Demo Approver",
  approverEmail: "demo-approver@example.com",
  stateCode: "KA",
});

const CREDENTIALS_PATH = path.join(root, "apps/landing/scripts/.demo-org-credentials.local.md");
const db = new Client({ connectionString, application_name: "vercentlabs-marketing-demo-seed" });
await db.connect();

const results = [];
async function step(name, work) {
  try {
    const value = await work();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
    return value;
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`  FAIL ${name}: ${error.code ?? ""} ${error.message}`);
    return null;
  }
}

let organizationId;
async function tx(work) {
  await db.query("BEGIN");
  try {
    if (organizationId) await setTenantContext(db, organizationId);
    const value = await work(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

const daysFromNow = (days) => new Date(Date.now() + days * 86_400_000);
const isoDate = (days) => daysFromNow(days).toISOString().slice(0, 10);

try {
  // ------------------------------------------------------------ organisation
  console.log("Organisation");
  let owner = (await db.query(
    `SELECT u.id, m.organization_id FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE lower(u.email)=lower($1) LIMIT 1`,
    [DEMO.ownerEmail],
  )).rows[0];
  if (!owner) {
    const registered = await tx((client) =>
      api.registerOrganization(client, {
        fullName: DEMO.ownerName,
        email: DEMO.ownerEmail,
        password: `Demo-${randomBytes(9).toString("base64url")}!7`,
        organizationName: DEMO.organizationName,
        countryCode: "IN",
        baseCurrency: "INR",
        timezone: "Asia/Kolkata",
      }),
    );
    owner = { id: registered.userId, organization_id: registered.organizationId };
    console.log(`  registered ${DEMO.organizationName}`);
  }
  organizationId = owner.organization_id;
  const ownerId = owner.id;
  // A fresh local-only password on every run, written to the gitignored file the capture script reads.
  const password = `Demo-${randomBytes(9).toString("base64url")}!7`;
  await db.query(`UPDATE users SET password_hash=$2, password_changed_at=now(), email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1`, [ownerId, await hashPassword(password)]);
  fs.writeFileSync(CREDENTIALS_PATH, `# Marketing demo organisation (local only — do not commit)\n\nOrganisation: ${DEMO.organizationName}\nEmail: ${DEMO.ownerEmail}\nPassword: ${password}\n`);
  console.log(`  credentials written to ${path.relative(root, CREDENTIALS_PATH)}`);
  const ownerSession = { organizationId, userId: ownerId, roleSlugs: ["organization_owner"], permissions: [...permissionsForRole("organization_owner")] };

  let company = (await db.query(`SELECT id FROM companies WHERE organization_id=$1 AND is_primary LIMIT 1`, [organizationId])).rows[0];
  if (!company) {
    company = await tx((client) =>
      api.createCompany(client, ownerSession, { name: DEMO.companyName, legalName: DEMO.companyName, code: DEMO.companyCode, countryCode: "IN", baseCurrency: "INR", isPrimary: true }),
    );
  }
  let branch = (await db.query(`SELECT id FROM branches WHERE organization_id=$1 AND company_id=$2 ORDER BY is_primary DESC LIMIT 1`, [organizationId, company.id])).rows[0];
  if (!branch) {
    branch = await tx((client) =>
      api.createBranch(client, ownerSession, { companyId: company.id, name: DEMO.branchName, code: DEMO.branchCode, timezone: "Asia/Kolkata", isPrimary: true }),
    );
  }
  for (const [table, column, value] of [["membership_company_access", "company_id", company.id], ["membership_branch_access", "branch_id", branch.id]]) {
    await db.query(`INSERT INTO ${table}(organization_id,user_id,${column}) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [organizationId, ownerId, value]);
  }
  const ctx = { ...ownerSession, activeCompanyId: company.id, companyId: company.id, activeBranchId: branch.id, allowAllCompanies: true };
  await tx((client) => api.seedBusinessDataFoundation(client, { organizationId, userId: ownerId }));
  // Sections below run only while their data is still empty, so a re-run completes an interrupted seed.
  const count = async (table) => Number((await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id=$1`, [organizationId])).rows[0].n);

  const lookup = async (sql, params = []) => (await db.query(sql, [organizationId, ...params])).rows[0];
  const uomEach = await lookup(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code='EA'`);
  const uomHour = await lookup(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code='HOUR'`);
  const taxable = await lookup(`SELECT id FROM tenant.tax_categories WHERE organization_id=$1 AND code='GST-TAXABLE'`);
  const salesList = await lookup(`SELECT id FROM tenant.price_lists WHERE organization_id=$1 AND code='STANDARD-SALES'`);
  const warehouse = await lookup(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 ORDER BY created_at LIMIT 1`);
  const create = (resource, input) => tx((client) => api.createBusinessDataRecord(client, ctx, resource, input));

  if (!(await count("tenant.tax_rates"))) await step("GST 18% tax rate", () => create("tax-rates", { taxCategoryId: taxable.id, name: "GST 18%", code: "GST18", taxType: "gst", rate: 18, status: "active" }));
  await step("sales settings", () => tx((client) => api.updateSalesSettings(client, ctx, { sellerStateCode: DEMO.stateCode, defaultPriceListId: salesList.id, allowDirectOrders: true })));

  // ------------------------------------------------------------ products
  console.log("Products");
  const PRODUCTS = [
    { code: "DEMO-A", name: "Demo Product A", itemType: "product", uomId: uomEach.id, salesPrice: 4200, standardCost: 2600, trackInventory: true },
    { code: "DEMO-B", name: "Demo Product B", itemType: "product", uomId: uomEach.id, salesPrice: 1850, standardCost: 1100, trackInventory: true },
    { code: "DEMO-C", name: "Demo Component C", itemType: "product", uomId: uomEach.id, salesPrice: 650, standardCost: 380, trackInventory: true },
    { code: "DEMO-D", name: "Demo Component D", itemType: "product", uomId: uomEach.id, salesPrice: 240, standardCost: 120, trackInventory: true },
    { code: "DEMO-SVC", name: "Demo Service Plan", itemType: "service", uomId: uomHour.id, salesPrice: 2500, standardCost: 0, trackInventory: false },
  ];
  const items = {};
  for (const product of PRODUCTS) {
    const existingItem = await lookup(`SELECT id FROM tenant.items WHERE organization_id=$1 AND code=$2`, [product.code]);
    if (existingItem) {
      items[product.code] = existingItem;
      continue;
    }
    const item = await step(`item ${product.name}`, () => create("items", { ...product, taxCategoryId: taxable.id, valuationMethod: "fifo", purchasePrice: product.standardCost, trackingType: "none", allowNegativeStock: false, status: "active" }));
    if (item) {
      items[product.code] = item;
      await step(`price ${product.name}`, () => tx((client) => api.upsertSalesPriceListItem(client, ctx, { priceListId: salesList.id, itemId: item.id, rate: product.salesPrice, minimumQuantity: 1 })));
    }
  }

  // ------------------------------------------------------------ CRM
  console.log("CRM");
  const ACCOUNTS = [
    { name: "Atlas Demo Retail", industry: "Retail", city: "Bengaluru" },
    { name: "Nova Demo Services", industry: "Professional services", city: "Pune" },
    { name: "Orbit Demo Manufacturing", industry: "Manufacturing", city: "Chennai" },
    { name: "Harbor Demo Logistics", industry: "Logistics", city: "Mumbai" },
    { name: "Juniper Demo Foods", industry: "Food & beverage", city: "Hyderabad" },
  ];
  const PEOPLE = [["Alex", "Demo"], ["Sam", "Sample"], ["Robin", "Example"], ["Jordan", "Placeholder"], ["Casey", "Testwell"]];
  const accounts = [];
  for (const [index, account] of ACCOUNTS.entries()) {
    const existingAccount = await lookup(`SELECT id, display_name FROM tenant.business_parties WHERE organization_id=$1 AND display_name=$2`, [account.name]);
    if (existingAccount) {
      accounts.push(existingAccount);
      continue;
    }
    const record = await step(`account ${account.name}`, () =>
      tx((client) => api.createCrmAccount(client, ctx, { displayName: account.name, industry: account.industry, city: account.city, countryCode: "IN", currencyCode: "INR", partyType: "customer", email: `accounts@${account.name.toLowerCase().replace(/\s+/g, "-")}.example.com` })),
    );
    if (!record) continue;
    accounts.push(record);
    const [firstName, lastName] = PEOPLE[index];
    await step(`contact ${firstName} ${lastName}`, () =>
      tx((client) => api.createCrmContact(client, ctx, { firstName, lastName, designation: "Operations Manager", email: `${firstName}.${lastName}@example.com`.toLowerCase(), accountId: record.id })),
    );
    await step(`billing address ${account.name}`, () =>
      create("addresses", { partyId: record.id, addressType: "billing", line1: `${index + 1} Demo Street`, city: account.city, state: "Karnataka", stateCode: DEMO.stateCode, postalCode: "560001", countryCode: "IN", isPrimary: true, status: "active" }),
    );
  }

  const LEADS = [
    ["Taylor", "Demo", "Polaris Demo Traders"],
    ["Morgan", "Sample", "Summit Demo Studios"],
    ["Riley", "Example", "Cedar Demo Clinics"],
    ["Avery", "Placeholder", "Lumen Demo Labs"],
    ["Quinn", "Testwell", "Meridian Demo Works"],
    ["Drew", "Demo", "Beacon Demo Outfitters"],
  ];
  const leads = [];
  for (const [firstName, lastName, companyName] of LEADS) {
    const existingLead = await lookup(`SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND company_name=$2`, [companyName]);
    if (existingLead) {
      leads.push(existingLead);
      continue;
    }
    const lead = await step(`lead ${companyName}`, () =>
      tx((client) => api.createCrmRecord(client, ctx, "leads", { firstName, lastName, companyName, email: `${firstName}.${lastName}@example.com`.toLowerCase(), countryCode: "IN", priority: "medium", rating: "warm" })),
    );
    if (lead) leads.push(lead);
  }

  let stages = (await db.query(`SELECT id, name, CASE WHEN is_won THEN 'won' WHEN is_lost THEN 'lost' ELSE 'open' END AS stage_type FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND status='active' ORDER BY sequence`, [organizationId])).rows;
  if (!stages.length) {
    let pipeline = await lookup(`SELECT id FROM tenant.crm_pipelines WHERE organization_id=$1 AND code='DEMO-SALES'`);
    if (!pipeline) pipeline = await step("pipeline Demo Sales", () => tx((client) => api.createCrmRecord(client, ctx, "pipelines", { companyId: company.id, name: "Demo Sales Pipeline", code: "DEMO-SALES", isDefault: true, status: "active", description: null })));
    for (const stage of [
      { name: "Qualification", stageType: "open", probability: 10, forecastCategory: "pipeline", staleAfterDays: 14 },
      { name: "Needs Analysis", stageType: "open", probability: 30, forecastCategory: "pipeline", staleAfterDays: 21 },
      { name: "Proposal", stageType: "open", probability: 60, forecastCategory: "best_case", staleAfterDays: 21 },
      { name: "Negotiation", stageType: "open", probability: 80, forecastCategory: "committed", staleAfterDays: 14 },
      { name: "Closed Won", stageType: "won" },
      { name: "Closed Lost", stageType: "lost" },
    ]) {
      await step(`sales stage ${stage.name}`, () => tx((client) => api.createSalesStage(client, ctx, { pipelineId: pipeline?.id, ...stage })));
    }
    stages = (await db.query(`SELECT id, name, CASE WHEN is_won THEN 'won' WHEN is_lost THEN 'lost' ELSE 'open' END AS stage_type FROM tenant.crm_pipeline_stages WHERE organization_id=$1 AND status='active' ORDER BY sequence`, [organizationId])).rows;
  }
  const openStages = stages.filter((stage) => stage.stage_type === "open");

  const OPPORTUNITIES = [
    ["Atlas Demo Retail — store rollout", 0, 1850000, 3],
    ["Nova Demo Services — annual plan", 1, 640000, 2],
    ["Orbit Demo Manufacturing — line expansion", 2, 2950000, 1],
    ["Harbor Demo Logistics — warehouse pilot", 3, 920000, 0],
    ["Juniper Demo Foods — new outlets", 4, 1240000, 2],
    ["Atlas Demo Retail — service add-on", 0, 310000, 0],
    ["Nova Demo Services — renewal", 1, 480000, 3],
  ];
  const opportunities = [];
  for (const [name, accountIndex, amount, stageIndex] of OPPORTUNITIES) {
    const account = accounts[accountIndex];
    if (!account || (await lookup(`SELECT id FROM tenant.crm_opportunities WHERE organization_id=$1 AND name=$2`, [name]))) continue;
    const opportunity = await step(`opportunity ${name}`, () =>
      tx((client) => api.createCrmRecord(client, ctx, "opportunities", { name, partyId: account.id, amount, currencyCode: "INR", expectedCloseDate: isoDate(20 + stageIndex * 10), nextStep: "Review proposal with the customer" })),
    );
    if (!opportunity) continue;
    opportunities.push(opportunity);
    for (const stage of openStages.slice(1, stageIndex + 1)) {
      await step(`  move to ${stage.name}`, () => tx((client) => api.moveOpportunityStage(client, ctx, opportunity.id, stage.id)));
    }
  }

  if (!(await count("tenant.crm_activities"))) for (const [index, opportunity] of opportunities.slice(0, 4).entries()) {
    await step(`task for ${opportunity.name}`, () =>
      tx((client) => api.createCrmTask(client, ctx, { subject: ["Prepare proposal", "Confirm delivery dates", "Review pricing", "Schedule follow-up call"][index], entityType: "opportunity", entityId: opportunity.id, priority: "medium", dueAt: daysFromNow(index + 2).toISOString() })),
    );
  }
  if (opportunities.length) for (const [index, lead] of leads.slice(0, 3).entries()) {
    await step(`follow-up for lead ${index + 1}`, () =>
      tx((client) => api.createCrmFollowUp(client, ctx, { subject: "Follow up on enquiry", entityType: "lead", entityId: lead.id, dueAt: daysFromNow(index + 1).toISOString() })),
    );
  }

  // ------------------------------------------------------------ Sales
  console.log("Sales");
  const billing = async (partyId) => lookup(`SELECT id FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 ORDER BY is_primary DESC LIMIT 1`, [partyId]);
  const QUOTES = [
    [0, [["DEMO-A", 4], ["DEMO-SVC", 6]]],
    [1, [["DEMO-SVC", 20]]],
    [2, [["DEMO-A", 10], ["DEMO-B", 12]]],
    [4, [["DEMO-B", 8]]],
  ];
  if (!(await count("tenant.sales_quotations"))) for (const [accountIndex, lines] of QUOTES) {
    const account = accounts[accountIndex];
    if (!account) continue;
    const address = await billing(account.id);
    await step(`quotation for ${account.displayName ?? account.display_name}`, () =>
      tx((client) =>
        api.createQuotation(client, ctx, {
          partyId: account.id,
          billingAddressId: address?.id,
          currencyCode: "INR",
          priceListId: salesList.id,
          validUntil: isoDate(30),
          lines: lines.filter(([code]) => items[code]).map(([code, quantity]) => ({ itemId: items[code].id, quantity })),
        }),
      ),
    );
  }
  const ORDERS = [
    [3, [["DEMO-A", 3], ["DEMO-B", 5]]],
    [0, [["DEMO-B", 6]]],
    [2, [["DEMO-A", 2]]],
  ];
  if (!(await count("tenant.sales_orders"))) for (const [accountIndex, lines] of ORDERS) {
    const account = accounts[accountIndex];
    if (!account) continue;
    const address = await billing(account.id);
    await step(`sales order for ${account.displayName ?? account.display_name}`, () =>
      tx((client) =>
        api.createSalesOrder(client, ctx, {
          partyId: account.id,
          billingAddressId: address?.id,
          currencyCode: "INR",
          priceListId: salesList.id,
          warehouseId: warehouse?.id,
          lines: lines.filter(([code]) => items[code]).map(([code, quantity]) => ({ itemId: items[code].id, quantity })),
        }),
      ),
    );
  }

  // Confirm two of the orders so the list shows real progress (availability check and reservation).
  {
    const drafts = (await db.query(`SELECT id FROM tenant.sales_orders WHERE organization_id=$1 AND lifecycle_status='draft' AND NOT EXISTS (SELECT 1 FROM tenant.sales_orders o WHERE o.organization_id=$1 AND o.lifecycle_status<>'draft') ORDER BY created_at LIMIT 2`, [organizationId])).rows;
    for (const order of drafts) await step("confirm sales order", () => tx((client) => api.confirmSalesOrder(client, ctx, order.id)));
  }

  // ------------------------------------------------------------ second user
  // Several modules enforce segregation of duties (the author of a supplier,
  // PO, BOM, journal or quality plan cannot approve it), so approvals come
  // from a second synthetic user. It has no usable password.
  console.log("Approver");
  let approver = (await db.query(`SELECT id FROM users WHERE lower(email)=lower($1)`, [DEMO.approverEmail])).rows[0];
  if (!approver) {
    approver = (await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES (gen_random_uuid(),$1,$2,'!','active',now()) RETURNING id`, [DEMO.approverEmail, DEMO.approverName])).rows[0];
  }
  await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active') ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active'`, [organizationId, approver.id]);
  const ownerRole = await lookup(`SELECT id FROM roles WHERE organization_id=$1 AND slug='organization_owner'`);
  if (ownerRole && !(await lookup(`SELECT 1 AS x FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2`, [approver.id]))) {
    await db.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status) VALUES ($1,$2,$3,true,'active')`, [organizationId, approver.id, ownerRole.id]);
  }
  for (const [table, column, value] of [["membership_company_access", "company_id", company.id], ["membership_branch_access", "branch_id", branch.id]]) {
    await db.query(`INSERT INTO ${table}(organization_id,user_id,${column}) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [organizationId, approver.id, value]);
  }
  const approverCtx = { ...ctx, userId: approver.id };

  // ------------------------------------------------------------ Accounting
  console.log("Accounting");
  const today = isoDate(0);
  const year = new Date().getUTCFullYear();
  if (!(await lookup(`SELECT id FROM tenant.fiscal_periods WHERE organization_id=$1 AND company_id=$2 AND start_date <= current_date AND end_date >= current_date`, [company.id]))) {
    await step("fiscal year", () => create("fiscal-periods", { companyId: company.id, name: `FY ${year}`, fiscalYear: `FY-${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31`, status: "open" }));
  }
  if (!(await count("tenant.accounting_accounts"))) {
    await step("accounting foundation", () => tx((client) => api.initializeAccountingCompany(client, { organizationId, companyId: company.id, userId: ownerId })));
  }
  const account = (code) => lookup(`SELECT a.id FROM tenant.accounting_accounts a JOIN tenant.accounting_ledgers l ON l.id=a.ledger_id WHERE a.organization_id=$1 AND a.company_id=$2 AND l.ledger_type='primary' AND a.code=$3`, [company.id, code]);
  if (!(await count("tenant.accounting_customer_invoices"))) {
    const INVOICES = [[0, "Store rollout — phase 1", 2, 185000], [1, "Annual service plan", 1, 240000], [3, "Warehouse pilot", 1, 96000], [4, "Outlet equipment", 4, 31000]];
    for (const [accountIndex, description, quantity, unitPrice] of INVOICES) {
      const party = accounts[accountIndex];
      if (!party) continue;
      const created = await step(`customer invoice ${description}`, () => tx((client) => api.createCustomerInvoice(client, ctx, { companyId: company.id, partyId: party.id, lines: [{ description, quantity, unitPrice }] })));
      const invoice = created?.invoice;
      if (!invoice) continue;
      await step("  submit", () => tx((client) => api.submitCustomerInvoice(client, ctx, invoice.id)));
      await step("  post", () => tx((client) => api.postCustomerInvoice(client, ctx, invoice.id)));
      if (accountIndex <= 1) {
        const receipt = await step("  receipt", () => tx((client) => api.createCustomerReceipt(client, ctx, { companyId: company.id, partyId: party.id, amount: quantity * unitPrice, paymentMethod: "bank_transfer" })));
        if (receipt) await step("  post receipt", () => tx((client) => api.postCustomerReceipt(client, ctx, receipt.id)));
      }
    }
  }
  if (!(await count("tenant.accounting_journal_entries"))) {
    const journal = await lookup(`SELECT id FROM tenant.accounting_journals WHERE organization_id=$1 AND company_id=$2 ORDER BY code LIMIT 1`, [company.id]);
    const cash = await account("1110");
    const capital = await account("3000");
    if (journal && cash && capital) {
      const created = await step("journal: opening capital", () => tx((client) => api.createJournalEntry(client, ctx, { companyId: company.id, journalId: journal.id, accountingDate: today, description: "Opening capital — demo company", lines: [{ accountId: cash.id, debit: 2500000 }, { accountId: capital.id, credit: 2500000 }] })));
      const entry = created?.entry;
      if (entry) {
        await step("  submit", () => tx((client) => api.submitJournalEntry(client, ctx, entry.id)));
        await step("  approve", () => tx((client) => api.approveJournalEntry(client, approverCtx, entry.id)));
        await step("  post", () => tx((client) => api.postJournalEntry(client, ctx, entry.id)));
      }
    }
  }

  // ------------------------------------------------------------ Inventory
  console.log("Inventory");
  const stockCtx = api.stockContext({ ...ctx });
  let secondWarehouse = await lookup(`SELECT id FROM tenant.warehouses WHERE organization_id=$1 AND code='DEMO-STORE'`);
  if (!secondWarehouse) secondWarehouse = await step("warehouse Demo Store Room", () => create("warehouses", { companyId: company.id, branchId: branch.id, name: "Demo Store Room", code: "DEMO-STORE", warehouseType: "stores", allowNegativeStock: false, status: "active" }));
  if (!(await count("tenant.stock_movements"))) {
    for (const [code, quantity, unitCost] of [["DEMO-A", 120, 2600], ["DEMO-B", 260, 1100], ["DEMO-C", 900, 380], ["DEMO-D", 2400, 120]]) {
      if (!items[code]) continue;
      await step(`receipt ${code}`, () => tx((client) => api.postStockMovement(client, stockCtx, { movementType: "receipt", itemId: items[code].id, warehouseId: warehouse.id, quantity, unitCost })));
    }
    if (items["DEMO-B"]) await step("issue DEMO-B", () => tx((client) => api.postStockMovement(client, stockCtx, { movementType: "issue", itemId: items["DEMO-B"].id, warehouseId: warehouse.id, quantity: 18 })));
  }
  if (!(await count("tenant.stock_transfers"))) {
    if (items["DEMO-A"] && secondWarehouse) {
      await step("transfer DEMO-A to store room", () => tx((client) => api.createStockTransfer(client, stockCtx, { itemId: items["DEMO-A"].id, sourceWarehouseId: warehouse.id, destinationWarehouseId: secondWarehouse.id, quantity: 12 })));
    }
  }

  // ------------------------------------------------------------ Procurement
  console.log("Procurement");
  const procCtx = api.procurementContext({ ...ctx });
  const procApprover = api.procurementContext({ ...approverCtx });
  if (!(await count("tenant.procurement_suppliers"))) {
    const SUPPLIERS = [["Summit Demo Supplies", "SUP-DEMO-1"], ["Keystone Demo Components", "SUP-DEMO-2"], ["Riverbend Demo Packaging", "SUP-DEMO-3"]];
    const suppliers = [];
    for (const [legalName, supplierCode] of SUPPLIERS) {
      const created = await step(`supplier ${legalName}`, () => tx((client) => api.createProcurementRecord(client, procCtx, "suppliers", { legalName, supplierCode, currencyCode: "INR" })));
      if (!created) continue;
      let current = created;
      for (const [actor, action] of [[procCtx, "submit"], [procApprover, "qualify"], [procApprover, "activate"]]) {
        current = (await step(`  ${action}`, () => tx((client) => api.transitionProcurementRecord(client, actor, "suppliers", created.id, action, { expectedVersion: current.version })))) ?? current;
      }
      suppliers.push(current);
    }
    const ORDERS_TO_SUPPLIERS = [[0, "Components for Q4 build", [["DEMO-C", 400, 380], ["DEMO-D", 1000, 120]], true], [1, "Replenishment — Product B", [["DEMO-B", 80, 1100]], false], [2, "Packaging stock", [["DEMO-D", 600, 118]], false]];
    for (const [supplierIndex, title, lines, receive] of ORDERS_TO_SUPPLIERS) {
      const supplier = suppliers[supplierIndex];
      if (!supplier) continue;
      const order = await step(`purchase order ${title}`, () =>
        tx((client) => api.createProcurementRecord(client, procCtx, "purchase-orders", {
          title,
          supplierId: supplier.id,
          expectedDeliveryDate: isoDate(14),
          lines: lines.filter(([code]) => items[code]).map(([code, quantity, unitPrice]) => ({ itemId: items[code].id, uomId: uomEach.id, warehouseId: warehouse.id, description: PRODUCTS.find((product) => product.code === code).name, quantity: String(quantity), unitPrice: String(unitPrice) })),
        })),
      );
      if (!order) continue;
      let po = order;
      for (const [actor, action] of [[procCtx, "submit"], [procApprover, "approve"], [procCtx, "dispatch"]]) {
        po = (await step(`  ${action}`, () => tx((client) => api.transitionProcurementRecord(client, actor, "purchase-orders", order.id, action, { expectedVersion: po.version })))) ?? po;
      }
      if (receive && po.lines?.length) {
        const receipt = await step("  goods receipt", () =>
          tx((client) => api.createProcurementRecord(client, procCtx, "receipts", {
            purchaseOrderId: order.id,
            receiptDate: today,
            lines: po.lines.map((line) => ({ purchaseOrderLineId: line.id, itemId: line.item_id, uomId: line.uom_id, warehouseId: line.warehouse_id, description: line.description, quantity: String(line.quantity), acceptedQuantity: String(line.quantity), rejectedQuantity: "0" })),
          })),
        );
        if (receipt) {
          const submitted = await step("  submit receipt", () => tx((client) => api.transitionProcurementRecord(client, procCtx, "receipts", receipt.id, "submit", { expectedVersion: receipt.version })));
          if (submitted) await step("  approve receipt (posts stock)", () => tx((client) => api.transitionProcurementReceiptWithStockMovement(client, procApprover, stockCtx, receipt.id, "approve", { expectedVersion: submitted.version })));
        }
      }
    }
  }

  // ------------------------------------------------------------ Manufacturing
  console.log("Manufacturing");
  const mfgCtx = api.manufacturingContext({ ...ctx });
  const mfgApprover = api.manufacturingContext({ ...approverCtx });
  if (!(await count("tenant.manufacturing_boms")) && items["DEMO-A"] && items["DEMO-C"] && items["DEMO-D"]) {
    const bom = await step("BOM Demo Product A", () => tx((client) => api.createBom(client, mfgCtx, { itemId: items["DEMO-A"].id, code: "BOM-DEMO-A", outputQuantity: 1, components: [{ itemId: items["DEMO-C"].id, quantity: 2 }, { itemId: items["DEMO-D"].id, quantity: 6, scrapPercent: 2 }] })));
    if (bom) {
      await step("  submit BOM", () => tx((client) => api.submitBom(client, mfgCtx, bom.id)));
      await step("  approve BOM", () => tx((client) => api.approveBom(client, mfgApprover, bom.id)));
      await step("manufacturing settings", () => tx((client) => api.updateManufacturingSettings(client, mfgCtx, { defaultWipWarehouseId: warehouse.id, defaultFinishedGoodsWarehouseId: warehouse.id })));
      for (const quantity of [25, 40]) {
        const order = await step(`production order x${quantity}`, () => tx((client) => api.createProductionOrder(client, mfgCtx, { itemId: items["DEMO-A"].id, quantity, materialWarehouseId: warehouse.id })));
        if (order && quantity === 25) await step("  release", () => tx((client) => api.releaseProductionOrder(client, mfgCtx, order.id)));
      }
    }
  }

  // ------------------------------------------------------------ Quality
  console.log("Quality");
  const qualityCtx = api.qualityContext({ ...ctx });
  const qualityApprover = api.qualityContext({ ...approverCtx });
  if (!(await count("tenant.quality_plans")) && items["DEMO-C"]) {
    const plan = await step("quality plan", () =>
      tx((client) => api.defineQualityPlan(client, qualityCtx, {
        code: "QP-DEMO-C",
        name: "Incoming check — Demo Component C",
        planType: "incoming",
        itemId: items["DEMO-C"].id,
        samplingMethod: "full",
        points: [
          { characteristic: "Length (mm)", resultType: "numeric", lowerLimit: 49.5, upperLimit: 50.5, critical: true },
          { characteristic: "Surface finish", resultType: "boolean" },
        ],
      })),
    );
    if (plan) {
      await step("  approve plan", () => tx((client) => api.approveQualityPlan(client, qualityApprover, plan.id)));
      for (const [lotQuantity, length] of [[40, 50.1], [60, 51.2], [25, 49.9]]) {
        const inspection = await step(`inspection lot ${lotQuantity}`, () => tx((client) => api.createQualityInspection(client, qualityCtx, { planId: plan.id, lotQuantity, sourceType: "manual" })));
        if (!inspection) continue;
        const points = Object.fromEntries(inspection.points.map((point) => [point.characteristic, point.id]));
        await step("  results", () => tx((client) => api.recordInspectionResults(client, qualityCtx, inspection.id, { results: [{ inspectionPointId: points["Length (mm)"], numericValue: length }, { inspectionPointId: points["Surface finish"], resultStatus: "pass" }] })));
        if (lotQuantity !== 25) await step("  complete", () => tx((client) => api.completeQualityInspection(client, qualityCtx, inspection.id, {})));
      }
    }
  }

  // ------------------------------------------------------------ Projects
  console.log("Projects");
  const projectsCtx = api.projectsContext({ ...ctx });
  const projectsApprover = api.projectsContext({ ...approverCtx });
  if (!(await count("tenant.projects"))) {
    const PROJECTS = [
      ["Atlas Demo store rollout", 0, ["Site survey", "Fit-out plan", "Equipment install", "Staff onboarding"]],
      ["Nova Demo service onboarding", 1, ["Kick-off", "Configuration", "Training"]],
    ];
    for (const [name, accountIndex, tasks] of PROJECTS) {
      const project = await step(`project ${name}`, () => tx((client) => api.createProjectRecord(client, projectsCtx, { name, customerId: accounts[accountIndex]?.id, projectManagerId: ownerId, plannedStartDate: isoDate(-20), plannedEndDate: isoDate(70) })));
      if (!project) continue;
      await step("  team member", () => tx((client) => api.saveProjectMember(client, projectsCtx, project.id, { userId: ownerId, roleName: "Project manager", allocationPercent: 40 })));
      await step("  milestone", () => tx((client) => api.saveProjectMilestone(client, projectsCtx, project.id, { name: "Go-live", dueDate: isoDate(60) })));
      await step("  plan", () => tx((client) => api.changeProjectStatus(client, projectsCtx, project.id, "plan")));
      await step("  approve", () => tx((client) => api.approveProjectRecord(client, projectsApprover, project.id)));
      await step("  activate", () => tx((client) => api.changeProjectStatus(client, projectsCtx, project.id, "activate")));
      for (const [index, taskName] of tasks.entries()) {
        const task = await step(`  task ${taskName}`, () => tx((client) => api.createProjectTaskRecord(client, projectsCtx, project.id, { name: taskName, assigneeUserId: ownerId, estimatedHours: 16 + index * 8 })));
        if (task && index < 2) await step(`  time on ${taskName}`, () => tx((client) => api.logProjectTime(client, projectsCtx, { projectId: project.id, taskId: task.id, workDate: isoDate(-(index + 2)), hours: 6 })));
      }
    }
  }

  // ------------------------------------------------------------ Support
  console.log("Support");
  const supportCtx = api.supportContext({ ...ctx });
  {
    const contacts = (await db.query(`SELECT id, party_id FROM tenant.contacts WHERE organization_id=$1`, [organizationId])).rows;
    const TICKETS = [
      [0, "Delivery note missing on order", "The delivery note was not included with the last shipment.", "high"],
      [1, "Update billing contact", "Please change the billing contact on our account.", "low"],
      [2, "Question about service plan hours", "How many hours remain on the current service plan?", "normal"],
      [3, "Damaged carton on receipt", "One carton arrived damaged at the warehouse.", "high"],
      [4, "Request copy of invoice", "Please share a copy of the latest invoice.", "low"],
    ];
    for (const [index, [accountIndex, subject, description, priority]] of TICKETS.entries()) {
      const party = accounts[accountIndex];
      if (!party || (await lookup(`SELECT id FROM tenant.support_tickets WHERE organization_id=$1 AND subject=$2`, [subject]))) continue;
      const contact = contacts.find((row) => row.party_id === party.id);
      const ticket = await step(`ticket ${subject}`, () => tx((client) => api.createTicket(client, supportCtx, { subject, description, customerId: party.id, contactId: contact?.id, priority, assignedUserId: index % 2 ? ownerId : undefined })));
      if (ticket && index < 3) await step("  open", () => tx((client) => api.transitionTicket(client, supportCtx, ticket.id, { action: "open" })));
      if (ticket && index === 0) await step("  resolve", () => tx((client) => api.transitionTicket(client, supportCtx, ticket.id, { action: "resolve", resolutionCode: "fixed" })));
    }
  }

  // ------------------------------------------------------------ HR & Payroll
  console.log("HR & Payroll");
  const hrCtx = api.hrContext({ ...ctx });
  if (!(await count("tenant.hr_employees"))) {
    const departments = {};
    for (const [code, name] of [["OPS", "Operations"], ["SAL", "Sales"], ["FIN", "Finance"]]) {
      departments[code] = await step(`department ${name}`, () => tx((client) => api.saveDepartment(client, hrCtx, { code, name })));
    }
    const EMPLOYEES = [["Demo", "Employee One", "OPS"], ["Demo", "Employee Two", "OPS"], ["Demo", "Employee Three", "SAL"], ["Demo", "Employee Four", "SAL"], ["Demo", "Employee Five", "FIN"], ["Demo", "Employee Six", "FIN"]];
    for (const [index, [firstName, lastName, departmentCode]] of EMPLOYEES.entries()) {
      const employee = await step(`employee ${firstName} ${lastName}`, () =>
        tx((client) => api.saveEmployee(client, hrCtx, { firstName, lastName, workEmail: `demo-employee-${index + 1}@example.com`, employmentType: "permanent", joiningDate: isoDate(-400 + index * 30), departmentId: departments[departmentCode]?.id })),
      );
      if (!employee) continue;
      await step("  complete joining", () => tx((client) => api.completeJoining(client, hrCtx, employee.id)));
      for (let day = 1; day <= 3; day += 1) {
        const date = daysFromNow(-day);
        if ([0, 6].includes(date.getUTCDay())) continue;
        await step(`  attendance ${isoDate(-day)}`, () => tx((client) => api.recordAttendance(client, hrCtx, { employeeId: employee.id, attendanceDate: isoDate(-day), status: index === 2 && day === 1 ? "remote" : "present", reason: "Recorded for the demo company" })));
      }
    }
  }

  // ------------------------------------------------------------ Assets
  console.log("Assets");
  const assetsCtx = api.assetsContext({ ...ctx });
  if (!(await count("tenant.assets"))) {
    const accountIds = {};
    for (const [key, code] of [["asset", "1500"], ["accumulated", "1590"], ["expense", "6300"], ["gainLoss", "4900"], ["clearing", "2900"], ["reserve", "3100"], ["impairment", "6500"], ["proceeds", "1120"]]) accountIds[key] = (await account(code))?.id;
    const categories = {};
    for (const [code, name, months, prefix] of [["EQP", "Equipment", 60, "EQ"], ["IT", "IT hardware", 36, "IT"], ["VEH", "Vehicles", 96, "VH"]]) {
      categories[code] = await step(`asset category ${name}`, () =>
        tx((client) => api.saveAssetCategory(client, assetsCtx, {
          code, name, usefulLifeMonths: months, depreciationMethod: "straight_line", tagPrefix: prefix,
          assetAccountId: accountIds.asset, accumulatedDepreciationAccountId: accountIds.accumulated, depreciationExpenseAccountId: accountIds.expense,
          gainLossAccountId: accountIds.gainLoss, clearingAccountId: accountIds.clearing, revaluationReserveAccountId: accountIds.reserve,
          impairmentLossAccountId: accountIds.impairment, proceedsAccountId: accountIds.proceeds,
        })),
      );
    }
    const site = await step("asset location Demo Head Office", () => tx((client) => api.saveAssetLocation(client, assetsCtx, { code: "HO", name: "Demo Head Office", locationType: "site" })));
    for (const [name, categoryCode, cost, serial] of [["Packing line conveyor", "EQP", 640000, "DEMO-EQ-001"], ["Forklift", "VEH", 1150000, "DEMO-VH-001"], ["Design workstation", "IT", 145000, "DEMO-IT-001"], ["Label printer", "EQP", 52000, "DEMO-EQ-002"], ["Delivery van", "VEH", 980000, "DEMO-VH-002"]]) {
      if (!categories[categoryCode]) continue;
      await step(`asset ${name}`, () => tx((client) => api.registerAsset(client, assetsCtx, { name, categoryId: categories[categoryCode].id, acquisitionCost: cost, serialNumber: serial, locationId: site?.id, criticality: "medium" })));
    }
  }

  // ------------------------------------------------------------ POS
  console.log("POS");
  if (!(await count("tenant.pos_stores"))) {
    const store = await step("store Demo Outlet", () => tx((client) => api.createStore(client, ctx, { code: "DEMO-OUT", name: "Demo Outlet — Central", warehouseId: secondWarehouse?.id ?? warehouse.id, branchId: branch.id })));
    if (store) await step("terminal Counter 1", () => tx((client) => api.createTerminal(client, ctx, { storeId: store.id, code: "T1", name: "Counter 1" })));
  }

  console.log(`\nDone: ${results.filter((result) => result.ok).length} ok, ${results.filter((result) => !result.ok).length} failed.`);
} finally {
  await db.end();
}
