// Fixture writers for the CRM DB suite. Rows are written with the migration
// role (the runtime-kit `owner` client); everything under test runs on the
// restricted runtime role inside tenant transactions.
import { randomUUID } from "node:crypto";

export const REP = ["crm.view", "crm.reports.view", "crm.leads.manage", "crm.opportunities.manage", "crm.activities.manage"];
export const MANAGER = [...REP, "crm.revenue.manage", "crm.analytics.manage"];
export const ADMIN = [...MANAGER, "crm.records.view_all", "crm.settings.manage"];

export function crmFixtures(kit, org) {
  const owner = kit.owner;
  const organizationId = org.organizationId;
  let sequence = 0;
  const next = (prefix) => `${prefix}-${++sequence}-${randomUUID().slice(0, 6)}`;

  async function pipeline(stages = [["Qualify", 10, 30], ["Propose", 50, 14], ["Negotiate", 80, null]]) {
    const id = randomUUID();
    await owner.query(`INSERT INTO tenant.crm_pipelines(id,organization_id,company_id,name,code,is_default,status) VALUES($1,$2,$3,'Sales',$4,true,'active')`, [id, organizationId, org.companyId, next("PL")]);
    const stageIds = [];
    let order = 1;
    for (const [name, probability, staleAfterDays] of stages) {
      const stageId = randomUUID();
      await owner.query(
        `INSERT INTO tenant.crm_pipeline_stages(id,organization_id,pipeline_id,name,code,sequence,probability,stale_after_days,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
        [stageId, organizationId, id, name, next("ST"), order++, probability, staleAfterDays],
      );
      stageIds.push(stageId);
    }
    return { id, stageIds };
  }

  async function opportunity(pipe, values = {}) {
    const id = randomUUID();
    const amount = values.amount ?? 1000;
    const probability = values.probability ?? 50;
    await owner.query(
      `INSERT INTO tenant.crm_opportunities(id,organization_id,company_id,branch_id,code,pipeline_id,stage_id,owner_user_id,party_id,source_id,name,amount,currency_code,probability,
         expected_close_date,actual_close_date,status,forecast_category,stage_entered_at,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,COALESCE($20::timestamptz,now()))`,
      [
        id, organizationId, org.companyId, org.branchId, next("OPP"), pipe.id, values.stageId ?? pipe.stageIds[0], values.ownerId ?? null, values.partyId ?? null, values.sourceId ?? null,
        values.name ?? next("Deal"), amount, values.currency ?? "INR", probability,
        values.expectedClose ?? null, values.actualClose ?? null, values.status ?? "open", values.category ?? "pipeline",
        values.stageEnteredAt ?? new Date().toISOString(), values.createdAt ?? null,
      ],
    );
    return id;
  }

  async function team(name, { managerId = null, parentId = null } = {}) {
    const id = randomUUID();
    await owner.query(`INSERT INTO tenant.crm_sales_teams(id,organization_id,company_id,parent_team_id,code,name,manager_user_id,status) VALUES($1,$2,$3,$4,$5,$6,$7,'active')`, [id, organizationId, org.companyId, parentId, next("TM"), name, managerId]);
    return id;
  }

  async function member(teamId, userId, { role = "seller", from = "2000-01-01", to = null, allocation = 100 } = {}) {
    await owner.query(
      `INSERT INTO tenant.crm_sales_team_members(organization_id,company_id,team_id,user_id,member_role,allocation_percent,effective_from,effective_to,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
      [organizationId, org.companyId, teamId, userId, role, allocation, from, to],
    );
  }

  async function territory(name, { parentId = null } = {}) {
    const id = randomUUID();
    await owner.query(`INSERT INTO tenant.crm_territories(id,organization_id,company_id,parent_territory_id,code,name,status) VALUES($1,$2,$3,$4,$5,$6,'active')`, [id, organizationId, org.companyId, parentId, next("TR"), name]);
    return id;
  }

  async function territoryAssignment(territoryId, assigneeType, assigneeId, { role = "primary", from = "2000-01-01", to = null } = {}) {
    await owner.query(
      `INSERT INTO tenant.crm_territory_assignments(organization_id,company_id,territory_id,assignee_type,assignee_id,assignment_role,effective_from,effective_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [organizationId, org.companyId, territoryId, assigneeType, assigneeId, role, from, to],
    );
  }

  async function rate(from, to, value, rateDate = "2000-01-01") {
    await owner.query(`INSERT INTO tenant.exchange_rates(organization_id,from_currency_code,to_currency_code,rate_date,rate,status) VALUES($1,$2,$3,$4,$5,'active')`, [organizationId, from, to, rateDate, value]);
  }

  async function quota({ userId = null, teamId = null, territoryId = null, start, end, amount, currency = "INR", status = "active" }) {
    await owner.query(
      `INSERT INTO tenant.crm_quota_plans(organization_id,company_id,team_id,territory_id,user_id,name,quota_type,period_start,period_end,currency_code,target_amount,status) VALUES($1,$2,$3,$4,$5,$6,'revenue',$7,$8,$9,$10,$11)`,
      [organizationId, org.companyId, teamId, territoryId, userId, next("Quota"), start, end, currency, amount, status],
    );
  }

  async function party(name) {
    const id = randomUUID();
    await owner.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status) VALUES($1,$2,$3,$4,'customer',$5,'active')`, [id, organizationId, org.companyId, next("P"), name]);
    return id;
  }

  async function period(name, start, end, status = "open") {
    const id = randomUUID();
    await owner.query(`INSERT INTO tenant.crm_forecast_periods(id,organization_id,company_id,name,period_type,period_start,period_end,status) VALUES($1,$2,$3,$4,'quarter',$5,$6,$7)`, [id, organizationId, org.companyId, name, start, end, status]);
    return id;
  }

  // A real CRM role (crm.view) assigned to the users, so eligibility checks
  // that read role grants (F005 assignee eligibility) see them as sellers.
  async function crmRole(userIds, permissions = ["crm.view"]) {
    const roleId = randomUUID();
    await owner.query(`INSERT INTO roles(id,organization_id,name,slug,is_system,status) VALUES($1,$2,'Test seller',$3,false,'active')`, [roleId, organizationId, next("seller")]);
    for (const permission of permissions) await owner.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES($1,$2)`, [roleId, permission]);
    for (const userId of userIds) await owner.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,status) VALUES($1,$2,$3,'active')`, [organizationId, userId, roleId]);
    return roleId;
  }

  return { pipeline, opportunity, team, member, territory, territoryAssignment, rate, quota, party, crmRole, period };
}
