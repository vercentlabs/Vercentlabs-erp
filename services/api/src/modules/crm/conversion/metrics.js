// Basic conversion metrics for a period, over the leads the caller can see:
// leads converted, the lead → opportunity conversion rate of the leads that
// arrived in the period, conversions by owner and by source, and the
// average days from a lead's creation to its conversion. Owner and source
// are those of the lead at the moment it was converted (the conversion record).
import { leadScopeSql, requireLeadPermission } from "../leads/access.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function period(input = {}) {
  const today = new Date();
  const from = DATE.test(String(input.from ?? "")) ? input.from : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = DATE.test(String(input.to ?? "")) ? input.to : today.toISOString().slice(0, 10);
  return { from, to };
}

export async function getLeadConversionMetrics(client, context, input = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.view, "You do not have permission to view leads.");
  const { from, to } = period(input);
  const values = [context.organizationId, from, to];
  const scope = leadScopeSql(context, values, "lead");
  const converted = `FROM tenant.crm_lead_conversions conversion
    JOIN tenant.crm_leads lead ON lead.organization_id = conversion.organization_id AND lead.id = conversion.lead_id
   WHERE conversion.organization_id = $1 AND conversion.converted_at >= $2::date AND conversion.converted_at < $3::date + interval '1 day'${scope}`;

  const totals = (await client.query(
    `SELECT count(*)::int AS converted,
            round((avg(EXTRACT(epoch FROM conversion.converted_at - COALESCE(conversion.lead_created_at, lead.created_at))) / 86400)::numeric, 1)::float8 AS average_days,
            count(*) FILTER (WHERE conversion.qualification_override)::int AS with_override
       ${converted}`,
    values,
  )).rows[0];
  const cohort = (await client.query(
    `SELECT count(*)::int AS created, count(*) FILTER (WHERE lead.status = 'converted')::int AS converted
       FROM tenant.crm_leads lead
      WHERE lead.organization_id = $1 AND lead.created_at >= $2::date AND lead.created_at < $3::date + interval '1 day' AND lead.merged_into_lead_id IS NULL${scope}`,
    values,
  )).rows[0];
  const byOwner = (await client.query(
    `SELECT conversion.lead_owner_user_id AS id, COALESCE(owner.full_name, 'Unassigned') AS name, count(*)::int AS converted
       ${converted.replace("JOIN tenant.crm_leads lead", "LEFT JOIN public.users owner ON owner.id = conversion.lead_owner_user_id JOIN tenant.crm_leads lead")}
      GROUP BY 1, 2 ORDER BY converted DESC, name`,
    values,
  )).rows;
  const bySource = (await client.query(
    `SELECT conversion.lead_source_id AS id, COALESCE(source.name, 'No source') AS name, count(*)::int AS converted
       ${converted.replace("JOIN tenant.crm_leads lead", "LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = conversion.organization_id AND source.id = conversion.lead_source_id JOIN tenant.crm_leads lead")}
      GROUP BY 1, 2 ORDER BY converted DESC, name`,
    values,
  )).rows;

  return {
    period: { from, to },
    converted: totals.converted,
    convertedWithOverride: totals.with_override,
    averageDaysToConvert: totals.average_days,
    leadsCreated: cohort.created,
    leadsCreatedAndConverted: cohort.converted,
    conversionRate: cohort.created ? Math.round((cohort.converted / cohort.created) * 1000) / 10 : 0,
    byOwner: byOwner.map((row) => ({ userId: row.id, name: row.name, converted: row.converted })),
    bySource: bySource.map((row) => ({ sourceId: row.id, name: row.name, converted: row.converted })),
  };
}
