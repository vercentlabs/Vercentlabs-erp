import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ROLE_TEMPLATE_BY_SLUG } from "../../../packages/permissions/src/roles.js";
import { listCrmAccounts, getCrmAccount } from "../src/modules/crm/prospect-and-relationship-master-data/account-operations.js";
import { listCrmContacts, getCrmContact } from "../src/modules/crm/prospect-and-relationship-master-data/contact-operations.js";
import { getAccountHierarchy, getCustomer360ForCaller, previewAccountMerge } from "../src/modules/crm/prospect-and-relationship-master-data/account-intelligence.js";
import { findAccountDuplicates, projectDuplicateMatchesForCaller } from "../src/modules/crm/prospect-and-relationship-master-data/duplicate-matching.js";
import { buildCrmLeadExportCsv } from "../src/modules/crm/prospect-and-relationship-master-data/lead-export.js";
import { listContactOpportunityRoles } from "../src/modules/crm/opportunity-and-pipeline-governance/opportunity-contacts.js";
import { getCrmReport } from "../src/modules/crm/pipeline-analytics-and-forecasting/analytics-service.js";
import { listCrmRecords } from "../src/modules/crm/crm-data-operations-and-customization/resource-query-service.js";
import { assertCrmOwnerAssignable } from "../src/modules/crm/crm-data-operations-and-customization/crm-access-scope.js";
import { redactInaccessibleCrmNotifications } from "../src/modules/crm/crm-data-operations-and-customization/notification-visibility.js";
import { getCrmRecordTimelinePage } from "../src/index.js";
import { listCrmTasks } from "../src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js";

// CRM record-visibility matrix against a REAL PostgreSQL database: the scope
// rules are SQL, so mocked clients cannot prove them. The test seeds its OWN
// organisation (users, companies, branch, pipeline, teams, records) inside
// one transaction that is always rolled back, so it runs on any migrated
// database — including CI's empty one — and leaves nothing behind.
//
// Role contexts are built from the real built-in role templates, so the
// matrix tests what tenants actually get, not hand-written permission lists.
//
// Runs when CRM_ACCESS_DB_URL (or MIGRATION_DATABASE_URL) is set. CI sets
// CRM_ACCESS_DB_REQUIRED=1, which turns a missing URL into a FAILURE instead
// of a silent skip.

const url = process.env.CRM_ACCESS_DB_URL || process.env.MIGRATION_DATABASE_URL;
const required = process.env.CRM_ACCESS_DB_REQUIRED === "1";

test("CRM access matrix: CI must not silently skip the real-database RBAC test", { skip: !required && "only enforced where CRM_ACCESS_DB_REQUIRED=1" }, () => {
  assert.ok(url, "CRM_ACCESS_DB_REQUIRED=1 but neither CRM_ACCESS_DB_URL nor MIGRATION_DATABASE_URL is set");
});

test("CRM access matrix (real database): roles, resources, relationships, 360, hierarchy, duplicates, reports, export, notifications", { skip: !url && "no database URL" }, async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    const tag = randomUUID().slice(0, 8);

    // ── Organisation, people, companies, branch, pipeline.
    const names = ["repA", "repB", "managerA", "managerB", "head", "admin", "teammate", "observer"];
    const user = {};
    for (const name of names) {
      user[name] = randomUUID();
      await client.query(`INSERT INTO public.users (id, email, full_name, password_hash) VALUES ($1,$2,$3,'x')`, [user[name], `${tag}-${name}@example.test`, `${tag} ${name}`]);
    }
    const org = randomUUID();
    await client.query(`INSERT INTO public.organizations (id, name, slug, base_currency, created_by, country_code, timezone) VALUES ($1,$2,$3,'INR',$4,'IN','Asia/Kolkata')`, [org, `Org ${tag}`, `org-${tag}`, user.admin]);
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [org]);
    for (const name of names) await client.query(`INSERT INTO public.organization_memberships (organization_id, user_id, role, status) VALUES ($1,$2,'member','active')`, [org, user[name]]);
    const company1 = randomUUID(), company2 = randomUUID(), branch = randomUUID();
    for (const [id, code] of [[company1, "C1"], [company2, "C2"]])
      await client.query(`INSERT INTO public.companies (id, organization_id, name, legal_name, country_code, base_currency, code) VALUES ($1,$2,$3,$3,'IN','INR',$4)`, [id, org, `${code} ${tag}`, `${code}${tag}`]);
    await client.query(`INSERT INTO public.branches (id, organization_id, company_id, name, code, timezone) VALUES ($1,$2,$3,'Main','MAIN','Asia/Kolkata')`, [branch, org, company1]);
    const pipeline = randomUUID(), stage = randomUUID();
    await client.query(`INSERT INTO tenant.crm_pipelines (id, organization_id, code, name) VALUES ($1,$2,'P','Pipeline')`, [pipeline, org]);
    await client.query(`INSERT INTO tenant.crm_pipeline_stages (id, organization_id, pipeline_id, code, name, sequence) VALUES ($1,$2,$3,'S1','Stage 1',1)`, [stage, org, pipeline]);
    // The Lead lifecycle's default stage (normally created by tenant bootstrap).
    await client.query(`INSERT INTO tenant.crm_lead_stages (organization_id, code, name) VALUES ($1,'new','New') ON CONFLICT DO NOTHING`, [org]);

    const permissionsOf = (slug) => [...ROLE_TEMPLATE_BY_SLUG.get(slug).permissions];
    const ctx = (userId, slugOrPermissions, companyId = company1) => ({
      organizationId: org, userId, activeCompanyId: companyId, activeBranchId: companyId === company1 ? branch : null, allowAllCompanies: false,
      permissions: Array.isArray(slugOrPermissions) ? slugOrPermissions : permissionsOf(slugOrPermissions), roleSlugs: [],
    });
    const repACtx = ctx(user.repA, "sales_representative"), managerACtx = ctx(user.managerA, "sales_manager"), managerBCtx = ctx(user.managerB, "sales_manager");
    const headCtx = ctx(user.head, "sales_head"), adminCtx = ctx(user.admin, "crm_administrator");
    const marketingCtx = ctx(user.observer, "marketing_manager"), successCtx = ctx(user.observer, "customer_success_manager");
    const partnerCtx = ctx(user.observer, "partner_manager"), auditorCtx = ctx(user.observer, "auditor"), readOnlyCtx = ctx(user.observer, "read_only");

    const team = async (manager, members) => {
      const id = randomUUID();
      await client.query(`INSERT INTO tenant.crm_sales_teams (id, organization_id, code, name, manager_user_id, status) VALUES ($1,$2,$3,$3,$4,'active')`, [id, org, `T-${manager.slice(0, 6)}`, manager]);
      for (const member of members) await client.query(`INSERT INTO tenant.crm_sales_team_members (organization_id, team_id, user_id, status) VALUES ($1,$2,$3,'active')`, [org, id, member]);
      return id;
    };
    const teamA = await team(user.managerA, [user.repA, user.teammate]);
    const teamB = await team(user.managerB, [user.repB]);

    const account = async (label, owner, { companyId = company1, parent = null, type = "prospect" } = {}) => {
      const id = randomUUID();
      await client.query(`INSERT INTO tenant.business_parties (id, organization_id, company_id, code, party_type, display_name, owner_user_id, parent_party_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`, [id, org, companyId, `A-${label}`, type, `${tag} ${label}`, owner, parent]);
      return id;
    };
    const opportunity = async (label, partyId, owner, amount) => {
      const id = randomUUID();
      await client.query(`INSERT INTO tenant.crm_opportunities (id, organization_id, company_id, code, name, pipeline_id, stage_id, party_id, owner_user_id, amount) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9)`, [id, org, company1, `O-${tag}-${label}`, pipeline, stage, partyId, owner, amount]);
      return id;
    };
    const activity = async (label, entityType, entityId, assignee) => {
      const id = randomUUID();
      await client.query(`INSERT INTO tenant.crm_activities (id, organization_id, company_id, entity_type, entity_id, activity_type, subject, assigned_to) VALUES ($1,$2,$3,$4,$5,'call',$6,$7)`, [id, org, company1, entityType, entityId, `${tag} ${label}`, assignee]);
      return id;
    };
    const contact = async (label, partyId, createdBy) => {
      const id = randomUUID();
      await client.query(`INSERT INTO tenant.contacts (id, organization_id, party_id, first_name, last_name, email, created_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`, [id, org, partyId, tag, label, `${tag}-${label}@example.test`, createdBy]);
      return id;
    };
    const lead = async (label, owner) => {
      const id = randomUUID();
      await client.query(`INSERT INTO tenant.crm_leads (id, organization_id, company_id, code, first_name, last_name, email, owner_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, org, company1, `L-${tag}-${label}`, tag, label, `${tag}-lead-${label}@example.test`, owner]);
      return id;
    };

    // ── Records.
    const shared = await account("shared", null);
    const hidden = await account("hidden-parent", user.repB);
    const accountX = await account("x", user.repB, { parent: hidden });
    const unrelated = await account("unrelated", user.repB);                         // prospect, Rep B only
    const customer = await account("customer", user.repB, { type: "customer" });     // Rep B's customer
    const partnerParty = await account("partner-co", user.repB);                      // the partner organisation
    const otherCompany = await account("co2", user.repA, { companyId: company2 });
    const oppA = await opportunity("a", accountX, user.repA, 100);
    const oppB = await opportunity("b", accountX, user.repB, 900);
    await opportunity("unrelated", unrelated, user.repB, 50);
    const oppPartner = await opportunity("partner", unrelated, user.repB, 70);
    const activityA = await activity("activity-a", "party", accountX, user.repA);
    const activityB = await activity("activity-b", "party", accountX, user.repB);
    const customerActivity = await activity("customer-activity", "party", customer, user.repB);
    const contactX = await contact("on-x", accountX, user.repB);
    const customerContact = await contact("on-customer", customer, user.repB);
    await client.query(`INSERT INTO tenant.crm_opportunity_contact_roles (organization_id, opportunity_id, contact_id) VALUES ($1,$2,$3),($1,$4,$3)`, [org, oppA, contactX, oppB]);
    const partnerAccount = randomUUID();
    await client.query(`INSERT INTO tenant.crm_partner_accounts (id, organization_id, company_id, party_id, name, partner_type) VALUES ($1,$2,$3,$4,'Partner','reseller')`, [partnerAccount, org, company1, partnerParty]);
    await client.query(`INSERT INTO tenant.crm_partner_deals (organization_id, company_id, partner_account_id, deal_registration_code, opportunity_id) VALUES ($1,$2,$3,$4,$5)`, [org, company1, partnerAccount, `DR-${tag}`, oppPartner]);
    const repALead = await lead("a", user.repA);
    const repBLead = await lead("b", user.repB);
    const teammateLead = await lead("teammate", user.teammate);
    const queueLead = await lead("queue", null);

    const accountsFor = async (c) => new Set((await listCrmAccounts(client, c, { search: tag, limit: 100 })).rows.map((row) => row.id));
    const contactsFor = async (c) => new Set((await listCrmContacts(client, c, { search: tag, limit: 100 })).rows.map((row) => row.id));
    const recordsFor = async (c, resource) => {
      const result = await listCrmRecords(client, c, resource, { search: tag, limit: 100 });
      return { ids: new Set(result.rows.map((row) => row.id)), total: Number(result.total) };
    };

    // ── Sales Rep vs Sales Manager (a team member is NOT a manager).
    const repALeads = await recordsFor(repACtx, "leads");
    assert.ok(repALeads.ids.has(repALead) && repALeads.ids.has(queueLead), "rep: own + unassigned queue");
    assert.equal(repALeads.ids.has(teammateLead), false, "rep: a TEAMMATE's Lead is not visible");
    assert.equal(repALeads.ids.has(repBLead), false);
    const managerALeads = await recordsFor(managerACtx, "leads");
    assert.ok(managerALeads.ids.has(repALead) && managerALeads.ids.has(teammateLead), "manager: managed team's Leads");
    assert.equal(managerALeads.ids.has(repBLead), false, "manager: another team's Lead is not visible");
    assert.equal(managerALeads.total, managerALeads.ids.size, "count and rows use the same scope");
    assert.equal((await recordsFor(headCtx, "leads")).ids.size, 4, "Sales Head: every Lead");
    // Opportunities and team-queue Tasks: same rule — only the MANAGER gains the team.
    const repAOpp = await opportunity("rep-a-own", shared, user.repA, 10);
    const teammateOpp = await opportunity("teammate", shared, user.teammate, 20);
    const repAOpps = await recordsFor(repACtx, "opportunities");
    assert.ok(repAOpps.ids.has(repAOpp) && !repAOpps.ids.has(teammateOpp), "rep: own Opportunity yes, teammate's no");
    const managerAOpps = await recordsFor(managerACtx, "opportunities");
    assert.ok(managerAOpps.ids.has(repAOpp) && managerAOpps.ids.has(teammateOpp), "manager: both team Opportunities");
    const task = async (label, assignee, teamId) => {
      const id = randomUUID();
      await client.query(`INSERT INTO tenant.crm_activities (id, organization_id, company_id, entity_type, activity_type, subject, assigned_to, team_id) VALUES ($1,$2,$3,'general','task',$4,$5,$6)`, [id, org, company1, `${tag} ${label}`, assignee, teamId]);
      return id;
    };
    const claimedByTeammate = await task("claimed-by-teammate", user.teammate, teamA);
    const unclaimedQueueTask = await task("unclaimed-queue", null, teamA);
    const tasksFor = async (c) => new Set((await listCrmTasks(client, c, { search: tag, limit: 100 })).rows.map((row) => row.id));
    const repATasks = await tasksFor(repACtx);
    assert.ok(repATasks.has(unclaimedQueueTask), "rep: unclaimed task in their team's queue");
    assert.equal(repATasks.has(claimedByTeammate), false, "rep: a task a TEAMMATE claimed is not visible (regression guard)");
    const managerATasks = await tasksFor(managerACtx);
    assert.ok(managerATasks.has(claimedByTeammate), "manager: a team member's claimed task");
    assert.ok(managerATasks.has(unclaimedQueueTask), "manager: their team's unclaimed queue");

    // ── Unowned-Account policy, ownership, deal link, company boundary.
    for (const [name, c] of [["rep", repACtx], ["manager", managerACtx], ["head", headCtx], ["admin", adminCtx]])
      assert.ok((await accountsFor(c)).has(shared), `unowned (shared) Account is visible to ${name}`);
    const repAAccounts = await accountsFor(repACtx);
    assert.ok(repAAccounts.has(accountX), "Account reachable through Rep A's own deal");
    assert.equal(repAAccounts.has(unrelated), false, "Account linked only to someone else's deal stays hidden");
    assert.equal(repAAccounts.has(otherCompany), false, "ownership never crosses the company boundary");
    assert.equal((await accountsFor(ctx(user.repA, "sales_representative", company2))).has(otherCompany), true);
    assert.ok((await accountsFor(managerBCtx)).has(unrelated), "Manager B sees Team B's Accounts");
    assert.equal((await accountsFor(managerACtx)).has(unrelated), false);

    // ── Record access ≠ field access: a visible Account still hides GSTIN/PAN
    // from a caller without crm.accounts.view_sensitive.
    await client.query(`UPDATE tenant.business_parties SET gstin='27AAAAA0000A1Z5', pan='AAAAA0000A' WHERE organization_id=$1 AND id=$2`, [org, shared]);
    const sharedFor = async (c) => (await listCrmAccounts(client, c, { search: tag, limit: 100 })).rows.find((row) => row.id === shared);
    const auditorView = await sharedFor(ctx(user.observer, "auditor"));
    assert.ok(auditorView, "Auditor can read the Account");
    assert.equal(auditorView.gstin, undefined, "…but not its GSTIN");
    assert.equal(auditorView.pan, undefined);
    assert.equal((await sharedFor(repACtx)).gstin, "27AAAAA0000A1Z5", "a role with crm.accounts.view_sensitive sees it");

    // ── Marketing Manager: every Lead — not the pipeline or customer base.
    const marketingLeads = await recordsFor(marketingCtx, "leads");
    assert.equal(marketingLeads.ids.size, 4, "Marketing: every Lead (other reps' included)");
    const marketingOpps = await recordsFor(marketingCtx, "opportunities");
    assert.equal(marketingOpps.ids.has(oppB), false, "Marketing: another rep's Opportunity is denied");
    const marketingAccounts = await accountsFor(marketingCtx);
    assert.equal(marketingAccounts.has(unrelated) || marketingAccounts.has(customer), false, "Marketing: owned Accounts are denied");
    await assert.doesNotReject(() => getCrmReport(client, marketingCtx, "campaigns", {}), "Marketing: campaign report works");
    await assert.doesNotReject(() => getCrmReport(client, marketingCtx, "attribution", {}));
    const marketingExport = await buildCrmLeadExportCsv(client, marketingCtx, { search: tag });
    assert.equal(marketingExport.rowCount, 4, "Marketing: Lead export = every Lead");

    // ── Customer Success: customer Accounts, their Contacts and Activities.
    const successAccounts = await accountsFor(successCtx);
    assert.ok(successAccounts.has(customer), "CS: a rep-owned CUSTOMER Account is visible");
    assert.equal(successAccounts.has(unrelated), false, "CS: an unrelated PROSPECT Account is denied");
    assert.ok((await contactsFor(successCtx)).has(customerContact), "CS: Contact under the customer Account");
    assert.equal((await recordsFor(successCtx, "leads")).ids.has(repBLead), false, "CS: another rep's Lead is denied");
    assert.equal((await recordsFor(successCtx, "opportunities")).ids.has(oppB), false, "CS: sales Opportunity is denied");
    const successActivities = await recordsFor(successCtx, "activities");
    assert.ok(successActivities.ids.has(customerActivity), "CS: Activity on a customer Account");
    assert.equal(successActivities.ids.has(activityB), false, "CS: Activity on a prospect Account is denied");
    await assert.doesNotReject(() => getCrmReport(client, successCtx, "account-health", {}), "CS: account health report works");

    // ── Partner Manager: partner-registered deals and partner Accounts only.
    const partnerOpps = await recordsFor(partnerCtx, "opportunities");
    assert.ok(partnerOpps.ids.has(oppPartner), "Partner: partner-registered Opportunity");
    assert.equal(partnerOpps.ids.has(oppB), false, "Partner: direct-sales Opportunity is denied");
    const partnerAccounts = await accountsFor(partnerCtx);
    assert.ok(partnerAccounts.has(partnerParty), "Partner: the partner's own Account");
    assert.ok(partnerAccounts.has(unrelated), "Partner: the customer Account behind a partner deal");
    assert.equal(partnerAccounts.has(accountX) || partnerAccounts.has(customer), false, "Partner: unrelated Accounts are denied");
    await assert.doesNotReject(() => getCrmReport(client, partnerCtx, "partner-pipeline", {}));
    const partnerDealActivity = await activity("partner-deal-activity", "opportunity", oppPartner, user.repB);
    const directDealActivity = await activity("direct-deal-activity", "opportunity", oppB, user.repB);
    const partnerActivities = await recordsFor(partnerCtx, "activities");
    assert.ok(partnerActivities.ids.has(partnerDealActivity), "Partner: Activity on a partner-registered Opportunity");
    assert.equal(partnerActivities.ids.has(directDealActivity), false, "Partner: Activity on a direct-sales Opportunity is denied");
    assert.equal(partnerActivities.ids.has(activityB), false);

    // ── Auditor and Read-only: company-wide READ, no mutation permissions.
    for (const [name, c] of [["auditor", auditorCtx], ["read-only", readOnlyCtx]]) {
      assert.equal((await recordsFor(c, "leads")).ids.size, 4, `${name}: every Lead`);
      assert.ok((await recordsFor(c, "opportunities")).ids.has(oppB), `${name}: every Opportunity`);
      const readable = await accountsFor(c);
      assert.ok(readable.has(unrelated), `${name}: every Account`);
      assert.equal(readable.has(otherCompany), false, `${name}: still inside the company boundary`);
      assert.deepEqual(c.permissions.filter((key) => key.startsWith("crm.") && (key.endsWith(".manage") || key === "crm.import")), [], `${name}: no CRM mutation/import/settings permission`);
    }
    const auditorExport = await buildCrmLeadExportCsv(client, auditorCtx, { search: tag });
    assert.equal(auditorExport.rowCount, (await recordsFor(auditorCtx, "leads")).total, "Auditor: export = read scope");
    await assert.rejects(() => buildCrmLeadExportCsv(client, readOnlyCtx, { search: tag }), { code: "CRM_EXPORT_FORBIDDEN" }, "Read-only: no export");

    // ── Account 360: child records use their OWN scope; counts and totals match.
    const view = await getCustomer360ForCaller(client, repACtx, accountX);
    const timelineIds = new Set(view.timeline.map((row) => row.entry_id));
    assert.equal(Number(view.metrics.opportunities), 1, "Rep A is told 1 deal, not 2");
    assert.ok(timelineIds.has(oppA) && !timelineIds.has(oppB) && timelineIds.has(activityA) && !timelineIds.has(activityB));
    assert.equal(view.timeline.filter((row) => row.entry_type === "opportunity").reduce((sum, row) => sum + Number(row.amount || 0), 0), 100);
    assert.equal(view.account.parent_name, "Restricted account");
    assert.equal(Number((await getCrmAccount(client, repACtx, accountX)).relationships.opportunities), 1);
    assert.equal(Number((await getCustomer360ForCaller(client, headCtx, accountX)).metrics.opportunities), 2, "Sales Head: both deals");
    const recordTimelineIds = new Set((await getCrmRecordTimelinePage(client, repACtx, "party", accountX, {})).rows.map((row) => row.id));
    assert.ok(recordTimelineIds.has(activityA) && !recordTimelineIds.has(activityB));
    assert.deepEqual((await listContactOpportunityRoles(client, repACtx, contactX)).map((row) => row.opportunityId), [oppA]);

    // ── Hierarchy: hidden ancestors leak neither ids, names nor depth.
    assert.equal((await getAccountHierarchy(client, repACtx, accountX)).ancestors.length, 0);
    assert.ok((await getAccountHierarchy(client, headCtx, accountX)).ancestors.some((row) => row.id === hidden));
    const repBHierarchy = await getAccountHierarchy(client, ctx(user.repB, "sales_representative"), hidden);
    assert.deepEqual(repBHierarchy.descendants.map((row) => [row.id, row.depth]), [[accountX, 1]]);

    // ── Merge, duplicates, reports.
    await assert.rejects(() => previewAccountMerge(client, repACtx, accountX, shared), { code: "CRM_MERGE_OUT_OF_SCOPE" });
    const dupes = projectDuplicateMatchesForCaller(repACtx, "account", await findAccountDuplicates(client, repACtx, { name: `${tag} unrelated` }));
    assert.ok(dupes.length > 0 && !dupes.some((row) => row.id === unrelated) && dupes.some((row) => row.restricted === true));
    const forecast = await getCrmReport(client, repACtx, "forecast", {});
    assert.ok(!forecast.rows.some((row) => (row.ownerUserId ?? row.owner_user_id) === user.repB));
    await assert.rejects(() => getCrmReport(client, repACtx, "campaigns", {}), { code: "CRM_REPORT_SCOPE_FORBIDDEN" });

    // ── Notifications: accessible target keeps its text; revoked target is redacted.
    const shown = await redactInaccessibleCrmNotifications(client, repACtx, [
      { id: "1", title: "Your Lead moved", message: "Acme", href: `/crm/leads/${repALead}` },
      { id: "2", title: "Acme Corp deal moved", message: "₹50 lakh", href: `/crm/leads/${repBLead}` },
      { id: "3", title: "Welcome", message: null, href: "/settings" },
    ]);
    assert.equal(shown[0].title, "Your Lead moved");
    assert.deepEqual([shown[1].title, shown[1].message, shown[1].href, shown[1].redacted], ["CRM record updated", "You no longer have access to this record.", null, true]);
    assert.equal(shown[2].title, "Welcome", "non-CRM notifications untouched");
    assert.equal(shown.length, 3, "redacted items stay in the list, so the unread badge and the list agree");
    const crmUnavailable = await redactInaccessibleCrmNotifications(client, repACtx, [{ id: "1", title: "Your Lead moved", message: "Acme", href: `/crm/leads/${repALead}` }], { canUseCrm: false });
    assert.equal(crmUnavailable[0].redacted, true, "CRM module unavailable: even the caller's own record is redacted");

    // ── Owner assignment.
    await assertCrmOwnerAssignable(client, managerACtx, user.repA);
    await assert.rejects(() => assertCrmOwnerAssignable(client, managerACtx, user.repB), { code: "CRM_OWNER_ASSIGNMENT_FORBIDDEN" });
    await assert.rejects(() => assertCrmOwnerAssignable(client, repACtx, user.teammate), { code: "CRM_OWNER_ASSIGNMENT_FORBIDDEN" }, "a rep cannot hand work to a teammate");
    await assertCrmOwnerAssignable(client, marketingCtx, user.repB, undefined, { resource: "leads" });
    await assert.rejects(() => assertCrmOwnerAssignable(client, marketingCtx, user.repB, undefined, { resource: "opportunities" }), { code: "CRM_OWNER_ASSIGNMENT_FORBIDDEN" });

    // ── Ended membership stops the manager's visibility immediately.
    await client.query(`UPDATE tenant.crm_sales_team_members SET effective_from = current_date - 10, effective_to = current_date - 1 WHERE organization_id=$1 AND team_id=$2`, [org, teamA]);
    assert.equal((await recordsFor(managerACtx, "leads")).ids.has(repALead), false);

    // ── Standalone Contacts: creator, creator's manager, view-all; disabled creator.
    const standalone = await contact("standalone-b", null, user.repB);
    assert.equal((await contactsFor(repACtx)).has(standalone), false);
    await client.query(`UPDATE public.organization_memberships SET status='disabled' WHERE organization_id=$1 AND user_id=$2`, [org, user.repB]);
    assert.ok((await contactsFor(managerBCtx)).has(standalone), "creator disabled: their manager still reaches it");
    assert.ok((await contactsFor(adminCtx)).has(standalone), "creator disabled: CRM Admin always reaches it");
    await client.query(`UPDATE tenant.crm_sales_team_members SET effective_from = current_date - 10, effective_to = current_date - 1 WHERE organization_id=$1 AND team_id=$2`, [org, teamB]);
    assert.equal((await contactsFor(managerBCtx)).has(standalone), false, "creator left the team: former manager loses it");
    assert.ok((await contactsFor(headCtx)).has(standalone), "…view-all users can still find and relink it");
    await assert.rejects(() => getCrmContact(client, repACtx, standalone), { code: "CRM_CONTACT_NOT_FOUND" });
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
});
