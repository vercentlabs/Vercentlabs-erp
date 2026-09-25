import assert from "node:assert/strict";
import test from "node:test";

import {
  matchLeadTerritory,
  normalizeTerritoryCoverage,
  normalizeTerritoryType,
  territoryCoverageMatch,
} from "../src/modules/crm/sales-organization-and-coverage/territory-coverage.js";
import { normalizeStorageInput } from "../src/modules/crm/crm-data-operations-and-customization/resource-validation.js";
import { resolveLeadAssignment } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/assignment/assignment-engine.js";

const org = "11111111-1111-4111-8111-111111111111";
const context = { organizationId: org, userId: "u1", activeCompanyId: null, permissions: [], roleSlugs: [] };
const maharashtra = { id: "t-mh", code: "MH", name: "Maharashtra", level: 0, assignment_rules: { countryCodes: ["IN"], states: ["Maharashtra"] } };
const ahilyanagar = { id: "t-ah", code: "MH-AHN", name: "Ahilyanagar", level: 1, assignment_rules: { countryCodes: ["IN"], states: ["Maharashtra"], cities: ["Ahilyanagar", "Shirdi"] } };
const dairy = { id: "t-dairy", code: "DAIRY", name: "Dairy vertical", level: 0, assignment_rules: { industries: ["Dairy"] } };

test("F020: an empty coverage box saves as {} instead of failing the NOT NULL column", () => {
  assert.deepEqual(normalizeTerritoryCoverage(null), {});
  assert.deepEqual(normalizeTerritoryCoverage(""), {});
  assert.equal(normalizeStorageInput("territories", { name: "Ahilyanagar", assignmentRules: null }).assignmentRules, "{}");
});

test("F020: coverage is structured, de-duplicated and validated", () => {
  assert.deepEqual(normalizeTerritoryCoverage({ countryCodes: ["in"], cities: "Ahilyanagar, Shirdi, ahilyanagar", states: [] }), {
    countryCodes: ["IN"],
    cities: ["Ahilyanagar", "Shirdi"],
  });
  assert.throws(() => normalizeTerritoryCoverage({ pinCodes: ["414001"] }), (error) => error.code === "CRM_TERRITORY_COVERAGE_INVALID");
  assert.throws(() => normalizeTerritoryCoverage({ countryCodes: ["India"] }), /two-letter country code/);
  assert.throws(() => normalizeTerritoryCoverage("{not json"), (error) => error.code === "CRM_TERRITORY_COVERAGE_INVALID");
});

test("F020: the territory type must be one the database accepts (a city name is not a type)", () => {
  assert.equal(normalizeTerritoryType("Industry"), "industry");
  assert.equal(normalizeTerritoryType(""), "geographic");
  assert.throws(() => normalizeTerritoryType("Ahilyanagar"), (error) => error.code === "CRM_TERRITORY_TYPE_INVALID");
});

test("F020: a lead matches when every listed dimension matches, case-insensitively", () => {
  assert.deepEqual(territoryCoverageMatch(ahilyanagar.assignment_rules, { countryCode: "IN", state: "maharashtra", city: "SHIRDI" }), ["country", "state", "city"]);
  assert.equal(territoryCoverageMatch(ahilyanagar.assignment_rules, { countryCode: "IN", state: "Maharashtra", city: "Pune" }), null);
  assert.equal(territoryCoverageMatch({}, { city: "Shirdi" }), null);
});

function territoryClient(rows) {
  return { query: async (sql) => (sql.includes("FROM tenant.crm_territories territory") ? { rows } : { rows: [] }) };
}

test("F020: the most specific matching territory wins (city beats state)", async () => {
  const matched = await matchLeadTerritory(territoryClient([maharashtra, ahilyanagar, dairy]), context, { countryCode: "IN", state: "Maharashtra", city: "Ahilyanagar" });
  assert.equal(matched.name, "Ahilyanagar");
  assert.deepEqual(matched.alternatives.map((alt) => alt.name), ["Maharashtra"]);
  assert.equal(await matchLeadTerritory(territoryClient([maharashtra]), context, { countryCode: "IN", state: "Karnataka" }), null);
});

test("F020: a territory rule without a named territory routes the lead to its matched territory's team", async () => {
  const policy = { id: "p1", mode: "territory", territory_id: null, criteria: {}, status: "active" };
  const client = {
    async query(sql, values) {
      if (sql.includes("FROM tenant.crm_lead_assignment_policies")) return { rows: [policy] };
      if (sql.includes("FROM tenant.crm_territories territory") && sql.includes("assignment_rules")) return { rows: [maharashtra, ahilyanagar] };
      if (sql.includes("territory_user.user_id")) return { rows: values[1] === "t-ah" ? [{ user_id: "rep-ahilyanagar" }] : [{ user_id: "rep-mumbai" }] };
      if (sql.includes("WITH candidate(user_id)")) return { rows: values[1].map((userId) => ({ user_id: userId, active_leads: 0 })) };
      return { rows: [] };
    },
  };
  const result = await resolveLeadAssignment(client, context, { countryCode: "IN", state: "Maharashtra", city: "Ahilyanagar" });
  assert.equal(result.ownerUserId, "rep-ahilyanagar");
  assert.equal(result.trace.territory.name, "Ahilyanagar");
});
