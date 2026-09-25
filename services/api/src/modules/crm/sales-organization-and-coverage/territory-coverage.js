import { CrmError } from "../crm-data-operations-and-customization/errors.js";

// F020 territory coverage: which leads a territory owns, as structured rules
// instead of free JSON. A rule set lists values per dimension; a lead matches
// when every dimension that has values matches (values within a dimension are
// alternatives). An empty rule set covers nothing automatically — the
// territory is then only used when a policy names it explicitly.

export const TERRITORY_TYPES = ["geographic", "industry", "account", "product", "channel", "named", "hybrid"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIMENSIONS = {
  countryCodes: { leadField: "countryCode", label: "country", max: 50 },
  states: { leadField: "state", label: "state", max: 100 },
  cities: { leadField: "city", label: "city", max: 300 },
  industries: { leadField: "industry", label: "industry", max: 100 },
  sourceIds: { leadField: "sourceId", label: "lead source", max: 50 },
};
const invalid = (message) => new CrmError(400, message, "CRM_TERRITORY_COVERAGE_INVALID");

// Accepts the structured object (or its JSON text from older callers); empty,
// null or missing means "no automatic coverage" and is stored as {} — the
// column is NOT NULL, and sending null used to fail the whole save with a 500.
export function normalizeTerritoryCoverage(value) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return {};
  let rules = value;
  if (typeof rules === "string") {
    try {
      rules = JSON.parse(rules);
    } catch {
      throw invalid("Territory coverage is not in a readable format.");
    }
  }
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) throw invalid("Territory coverage must list values per dimension.");
  const normalized = {};
  for (const [key, raw] of Object.entries(rules)) {
    const dimension = DIMENSIONS[key];
    if (!dimension) throw invalid(`Territory coverage cannot use "${key}". Use countries, states, cities, industries or lead sources.`);
    const list = (Array.isArray(raw) ? raw : String(raw ?? "").split(","))
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    const unique = list.filter((item, index) => list.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === index);
    if (unique.length > dimension.max) throw invalid(`A territory can list at most ${dimension.max} values for ${dimension.label}.`);
    if (key === "countryCodes") {
      const bad = unique.find((code) => !/^[A-Za-z]{2}$/.test(code));
      if (bad) throw invalid(`"${bad}" is not a two-letter country code (for example IN).`);
    }
    if (key === "sourceIds") {
      const bad = unique.find((id) => !UUID.test(id));
      if (bad) throw invalid("A lead source in the territory coverage is invalid.");
    }
    if (unique.length) normalized[key] = key === "countryCodes" ? unique.map((code) => code.toUpperCase()) : unique;
  }
  return normalized;
}

export function normalizeTerritoryType(value) {
  const type = String(value ?? "").trim().toLowerCase();
  if (!type) return "geographic";
  if (!TERRITORY_TYPES.includes(type))
    throw new CrmError(400, `Territory type must be one of: ${TERRITORY_TYPES.join(", ")}.`, "CRM_TERRITORY_TYPE_INVALID");
  return type;
}

// Which dimensions of `rules` the lead satisfies; null when any listed
// dimension fails (or nothing is listed). Text compares case-insensitively.
export function territoryCoverageMatch(rules, lead) {
  // Fixed dimension order (country, state, city, …) — jsonb does not keep key order.
  const listed = Object.keys(DIMENSIONS).map((key) => [key, rules?.[key]]).filter(([, values]) => Array.isArray(values) && values.length);
  if (!listed.length) return null;
  const matchedOn = [];
  for (const [key, values] of listed) {
    const actual = String(lead?.[DIMENSIONS[key].leadField] ?? "").trim().toLowerCase();
    if (!actual || !values.some((value) => String(value).trim().toLowerCase() === actual)) return null;
    matchedOn.push(DIMENSIONS[key].label);
  }
  return matchedOn;
}

// The territory a lead falls in: among active territories whose coverage
// matches, the most specific wins (more dimensions, then a city rule, then a
// deeper place in the hierarchy, then code) so "Pune" beats "Maharashtra".
export async function matchLeadTerritory(client, context, lead) {
  const values = [context.organizationId];
  let companyFilter = "";
  const companyId = lead?.companyId || context.activeCompanyId || null;
  if (companyId) {
    values.push(companyId);
    companyFilter = ` AND (territory.company_id IS NULL OR territory.company_id=$${values.length})`;
  }
  const { rows } = await client.query(
    `WITH RECURSIVE depth AS (
       SELECT id, 0 AS level FROM tenant.crm_territories WHERE organization_id=$1 AND parent_territory_id IS NULL
       UNION ALL
       SELECT child.id, depth.level+1 FROM tenant.crm_territories child JOIN depth ON child.parent_territory_id=depth.id WHERE child.organization_id=$1 AND depth.level<20
     )
     SELECT territory.id,territory.code,territory.name,territory.assignment_rules,COALESCE(depth.level,0) AS level
       FROM tenant.crm_territories territory
       LEFT JOIN depth ON depth.id=territory.id
      WHERE territory.organization_id=$1 AND territory.status='active' AND territory.assignment_rules <> '{}'::jsonb${companyFilter}`,
    values,
  );
  const matches = rows
    .map((territory) => ({ territory, matchedOn: territoryCoverageMatch(territory.assignment_rules, lead) }))
    .filter((candidate) => candidate.matchedOn)
    .sort(
      (a, b) =>
        b.matchedOn.length - a.matchedOn.length ||
        Number(b.matchedOn.includes("city")) - Number(a.matchedOn.includes("city")) ||
        Number(b.territory.level) - Number(a.territory.level) ||
        String(a.territory.code).localeCompare(String(b.territory.code)),
    );
  if (!matches.length) return null;
  const [best] = matches;
  return {
    territoryId: String(best.territory.id),
    code: best.territory.code,
    name: best.territory.name,
    matchedOn: best.matchedOn,
    alternatives: matches.slice(1).map((candidate) => ({ territoryId: String(candidate.territory.id), name: candidate.territory.name, matchedOn: candidate.matchedOn })),
  };
}
