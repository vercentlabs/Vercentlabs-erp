// Campaigns (CRM plan 3.4): what the business ran to bring leads in, and what came of it. A lead names its campaign and medium; the deal
// it becomes keeps both, so each campaign shows its leads, the ones converted, its deals, those won and the value won (in the base
// currency), against its budget. Managed by whoever manages CRM settings; anyone who sees leads may pick a campaign on one.
import { isCrmMedium } from "@vercentlabs/shared-types";

import { CrmError } from "../data-management/errors.js";
import { currencyDisclosure, dealRate, reportingCurrencyOf, sumWonReporting, unconvertedCount, unconvertedCurrencies } from "../data-management/reporting-currency.js";

export const CAMPAIGN_PERMISSION = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
const invalid = (field, message) => new CrmError(400, message, "CRM_CAMPAIGN_VALIDATION", { issues: [{ field, message }] });
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(CAMPAIGN_PERMISSION)) return;
  throw new CrmError(403, "You do not have permission to manage campaigns.", "PERMISSION_DENIED");
}

function toCampaign(row) {
  return {
    id: row.id, name: row.name, code: row.code, medium: row.medium, status: row.status,
    startsOn: row.starts_on_text ?? null, endsOn: row.ends_on_text ?? null,
    budget: row.budget === null || row.budget === undefined ? null : Number(row.budget), currencyCode: row.currency_code ? String(row.currency_code).trim() : null,
    description: row.description, createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.lead_count !== undefined ? {
      stats: {
        leads: row.lead_count, convertedLeads: row.converted_count, deals: row.deal_count, openDeals: row.open_count, wonDeals: row.won_count,
        wonValue: Number(row.won_value ?? 0),
      },
    } : {}),
  };
}

const BASE = `SELECT campaign.*, to_char(campaign.starts_on, 'YYYY-MM-DD') AS starts_on_text, to_char(campaign.ends_on, 'YYYY-MM-DD') AS ends_on_text FROM tenant.crm_campaigns campaign`;

// The campaigns to pick from on a lead or deal: active ones (and the one already chosen).
export async function listCampaignOptions(client, context) {
  const { rows } = await client.query(`${BASE} WHERE campaign.organization_id = $1 AND campaign.status = 'active' ORDER BY lower(campaign.name)`, [context.organizationId]);
  return rows.map((row) => ({ id: row.id, name: row.name, code: row.code, medium: row.medium }));
}

// Every campaign with its results, newest first.
export async function listCampaigns(client, context, { includeArchived = true } = {}) {
  requireManage(context);
  const { rows } = await client.query(
    `WITH deals AS (
       SELECT opportunity.*, ${dealRate("opportunity")} AS reporting_rate FROM tenant.crm_opportunities opportunity
        WHERE opportunity.organization_id = $1 AND opportunity.campaign_id IS NOT NULL AND opportunity.archived_at IS NULL)
     SELECT campaign.*, to_char(campaign.starts_on, 'YYYY-MM-DD') AS starts_on_text, to_char(campaign.ends_on, 'YYYY-MM-DD') AS ends_on_text,
            (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = campaign.organization_id AND lead.campaign_id = campaign.id AND lead.archived_at IS NULL) AS lead_count,
            (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = campaign.organization_id AND lead.campaign_id = campaign.id AND lead.status = 'converted') AS converted_count,
            stats.deal_count, stats.open_count, stats.won_count, stats.won_value, stats.unconverted_count, stats.unconverted_currencies
       FROM tenant.crm_campaigns campaign
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS deal_count, count(*) FILTER (WHERE deals.status = 'open')::int AS open_count, count(*) FILTER (WHERE deals.status = 'won')::int AS won_count,
                ${sumWonReporting("deals", "deals.status = 'won'")} AS won_value, ${unconvertedCount("deals", "deals.status = 'won'")} AS unconverted_count,
                ${unconvertedCurrencies("deals", "deals.status = 'won'")} AS unconverted_currencies
           FROM deals WHERE deals.campaign_id = campaign.id) stats ON true
      WHERE campaign.organization_id = $1 ${includeArchived ? "" : "AND campaign.status = 'active'"}
      ORDER BY (campaign.status = 'active') DESC, COALESCE(campaign.starts_on, campaign.created_at::date) DESC, lower(campaign.name)`,
    [context.organizationId]);
  const reportingCurrency = await reportingCurrencyOf(client, context.organizationId);
  const unconverted = rows.reduce((total, row) => total + Number(row.unconverted_count ?? 0), 0);
  return {
    campaigns: rows.map(toCampaign),
    currency: currencyDisclosure(reportingCurrency, { unconverted_count: unconverted, unconverted_currencies: [...new Set(rows.flatMap((row) => row.unconverted_currencies ?? []))] }),
  };
}

export async function getCampaign(client, context, campaignId) {
  if (!UUID.test(String(campaignId ?? ""))) throw new CrmError(404, "Campaign not found.", "CRM_CAMPAIGN_NOT_FOUND");
  const row = (await client.query(`${BASE} WHERE campaign.organization_id = $1 AND campaign.id = $2`, [context.organizationId, campaignId])).rows[0];
  if (!row) throw new CrmError(404, "Campaign not found.", "CRM_CAMPAIGN_NOT_FOUND");
  return toCampaign(row);
}

async function clean(client, context, input, current = null) {
  const next = {};
  if (!current || has(input, "name")) {
    next.name = text(input.name).slice(0, 160);
    if (!next.name) throw invalid("name", "Name the campaign.");
    const taken = (await client.query("SELECT 1 FROM tenant.crm_campaigns WHERE organization_id = $1 AND lower(name) = lower($2) AND id IS DISTINCT FROM $3",
      [context.organizationId, next.name, current?.id ?? null])).rows[0];
    if (taken) throw invalid("name", "Another campaign already has this name.");
  }
  if (has(input, "code")) {
    next.code = text(input.code).toLowerCase().replace(/\s+/g, "_") || null;
    if (next.code && !/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(next.code)) throw invalid("code", "Use letters, digits, dots, dashes or underscores, as in utm_campaign.");
    if (next.code && (await client.query("SELECT 1 FROM tenant.crm_campaigns WHERE organization_id = $1 AND code = $2 AND id IS DISTINCT FROM $3",
      [context.organizationId, next.code, current?.id ?? null])).rows[0]) throw invalid("code", "Another campaign already has this code.");
  }
  if (has(input, "medium")) {
    next.medium = text(input.medium) || null;
    if (next.medium && !isCrmMedium(next.medium)) throw invalid("medium", "Choose a medium from the list.");
  }
  for (const [field, column] of [["startsOn", "startsOn"], ["endsOn", "endsOn"]]) {
    if (!has(input, field)) continue;
    next[column] = text(input[field]).slice(0, 10) || null;
    if (next[column] && !isDay(next[column])) throw invalid(field, "Enter a valid date.");
  }
  const starts = has(next, "startsOn") ? next.startsOn : current?.startsOn;
  const ends = has(next, "endsOn") ? next.endsOn : current?.endsOn;
  if (starts && ends && starts > ends) throw invalid("endsOn", "The end date is before the start date.");
  if (has(input, "budget")) {
    next.budget = input.budget === null || text(input.budget) === "" ? null : Number(input.budget);
    if (next.budget !== null && (!Number.isFinite(next.budget) || next.budget < 0)) throw invalid("budget", "Enter a budget of zero or more.");
  }
  if (has(input, "currencyCode")) {
    next.currencyCode = text(input.currencyCode).toUpperCase() || null;
    if (next.currencyCode && !/^[A-Z]{3}$/.test(next.currencyCode)) throw invalid("currencyCode", "Choose a currency.");
  }
  if (has(input, "description")) next.description = text(input.description).slice(0, 4000) || null;
  return next;
}

export async function createCampaign(client, context, input = {}) {
  requireManage(context);
  const next = await clean(client, context, input);
  const base = (await client.query("SELECT base_currency FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.base_currency ?? null;
  const row = (await client.query(
    `INSERT INTO tenant.crm_campaigns (organization_id, name, code, medium, starts_on, ends_on, budget, currency_code, description, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
    [context.organizationId, next.name, next.code ?? null, next.medium ?? null, next.startsOn ?? null, next.endsOn ?? null, next.budget ?? null,
      next.currencyCode ?? (next.budget !== undefined && next.budget !== null ? base : null), next.description ?? null, context.userId ?? null])).rows[0];
  return getCampaign(client, context, row.id);
}

const COLUMNS = { name: "name", code: "code", medium: "medium", startsOn: "starts_on", endsOn: "ends_on", budget: "budget", currencyCode: "currency_code", description: "description" };

export async function updateCampaign(client, context, campaignId, input = {}) {
  requireManage(context);
  const current = await getCampaign(client, context, campaignId);
  const next = await clean(client, context, input, current);
  const sets = [];
  const values = [context.organizationId, current.id];
  for (const [field, column] of Object.entries(COLUMNS)) if (has(next, field)) { values.push(next[field]); sets.push(`${column} = $${values.length}`); }
  if (sets.length) {
    values.push(context.userId ?? null);
    await client.query(`UPDATE tenant.crm_campaigns SET ${sets.join(", ")}, updated_by = $${values.length}, updated_at = now() WHERE organization_id = $1 AND id = $2`, values);
  }
  return getCampaign(client, context, current.id);
}

// Archived, a campaign is no longer offered for new leads; the leads and deals that name it keep it.
export async function setCampaignStatus(client, context, campaignId, status) {
  requireManage(context);
  if (!["active", "archived"].includes(status)) throw invalid("status", "Choose active or archived.");
  const current = await getCampaign(client, context, campaignId);
  await client.query("UPDATE tenant.crm_campaigns SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, current.id, status, context.userId ?? null]);
  return getCampaign(client, context, current.id);
}

// For a lead or deal: the campaign must be this organization's, and active unless it is the one already set.
export async function assertUsableCampaign(client, context, campaignId, currentId = null) {
  if (!campaignId || campaignId === currentId) return;
  if (!UUID.test(String(campaignId))) throw new CrmError(400, "Choose a campaign from the list.", "CRM_CAMPAIGN_INVALID", { issues: [{ field: "campaignId", message: "Choose a campaign from the list." }] });
  const row = (await client.query("SELECT status FROM tenant.crm_campaigns WHERE organization_id = $1 AND id = $2", [context.organizationId, campaignId])).rows[0];
  if (!row) throw new CrmError(400, "Choose a campaign from the list.", "CRM_CAMPAIGN_INVALID", { issues: [{ field: "campaignId", message: "Choose a campaign from the list." }] });
  if (row.status !== "active") throw new CrmError(409, "This campaign is archived. Choose another.", "CRM_CAMPAIGN_ARCHIVED", { issues: [{ field: "campaignId", message: "This campaign is archived." }] });
}

// A utm_campaign value as one of the organization's active campaigns (by its code, then its name), or null.
export async function campaignFromUtm(client, organizationId, value) {
  const key = text(value).toLowerCase();
  if (!key) return null;
  const row = (await client.query(
    `SELECT id, medium FROM tenant.crm_campaigns WHERE organization_id = $1 AND status = 'active' AND (code = $2 OR lower(name) = $2) ORDER BY (code = $2) DESC LIMIT 1`,
    [organizationId, key])).rows[0];
  return row ?? null;
}
