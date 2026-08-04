import assert from "node:assert/strict";
import fs from "node:fs";

const requiredFiles = [
  "database/tenant/migrations/034_crm_marketing_execution.sql",
  "services/api/src/crm/marketing-execution.js",
  "services/api/src/crm/marketing-execution.d.ts",
  "services/api/tests/crm-marketing-execution-crm07.test.mjs",
  "apps/web/src/lib/crm-marketing-route.ts",
  "apps/web/src/app/api/crm/marketing/dashboard/route.ts",
  "apps/web/src/app/api/crm/marketing/readiness/route.ts",
  "apps/web/src/app/api/crm/marketing/segments/route.ts",
  "apps/web/src/app/api/crm/marketing/campaigns/route.ts",
  "apps/web/src/app/api/crm/marketing/journeys/route.ts",
  "apps/web/src/app/api/crm/marketing/events/route.ts",
  "apps/web/src/app/api/crm/marketing/surveys/route.ts",
  "apps/web/src/app/api/crm/marketing/attribution/route.ts",
  "apps/web/src/app/api/crm/marketing/public/surveys/[token]/route.ts",
  "apps/web/src/app/api/crm/marketing/public/events/[token]/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/marketing/route.ts",
  "apps/web/src/app/(app)/crm/marketing/page.tsx",
  "apps/web/scripts/verify-crm-marketing-execution-live.mjs",
  "docs/implementation/stages/CRM_07_MARKETING_EXECUTION.md",
];
for (const file of requiredFiles)
  assert.ok(fs.existsSync(file), `Missing CRM-07 file: ${file}`);

const migration = fs.readFileSync(requiredFiles[0], "utf8");
for (const table of [
  "crm_marketing_segments",
  "crm_marketing_segment_members",
  "crm_marketing_campaign_runs",
  "crm_marketing_deliveries",
  "crm_marketing_journeys",
  "crm_marketing_journey_steps",
  "crm_marketing_journey_enrollments",
  "crm_marketing_experiments",
  "crm_marketing_experiment_variants",
  "crm_marketing_touchpoints",
  "crm_marketing_events",
  "crm_marketing_event_registrations",
  "crm_marketing_surveys",
  "crm_marketing_survey_responses",
  "crm_marketing_frequency_policies",
  "crm_marketing_acceptance_runs",
])
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /crm_public_marketing_survey/);
assert.match(migration, /crm_public_marketing_event/);
assert.match(migration, /crm_marketing_acceptance_immutable/);

const service = fs.readFileSync(requiredFiles[1], "utf8");
for (const symbol of [
  "normalizeMarketingSegmentDefinition",
  "compileMarketingSegmentFilter",
  "normalizeJourneyDefinition",
  "assignMarketingExperimentVariant",
  "calculateMarketingAttributionWeights",
  "evaluateMarketingFrequencyPolicy",
  "validateMarketingSurveyDefinition",
  "buildMarketingDeliveryCommand",
  "saveMarketingSegment",
  "refreshMarketingSegment",
  "saveMarketingCampaign",
  "createMarketingCampaignRun",
  "processMarketingCampaignRun",
  "saveMarketingJourney",
  "enrollMarketingJourney",
  "advanceMarketingJourney",
  "saveMarketingExperiment",
  "saveMarketingEvent",
  "registerMarketingEvent",
  "saveMarketingSurvey",
  "submitMarketingSurveyResponse",
  "recordMarketingTouchpoint",
  "getMarketingAttributionReport",
  "getMarketingDashboard",
  "recordCrmMarketingAcceptance",
  "getCrmMarketingReadiness",
])
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
assert.match(service, /consentEmail/);
assert.match(service, /frequency_cap/);
assert.match(service, /position_based/);
assert.match(service, /idempotencyKey/);

const capabilityIds = [
  "CRM-064",
  "CRM-065",
  "CRM-066",
  "CRM-067",
  "CRM-068",
  "CRM-069",
  "CRM-070",
  "CRM-071",
];
const evidence = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of capabilityIds) {
  const entry = evidence.find((row) => row.id === id);
  assert.equal(
    entry?.registerStatus,
    "Implemented",
    `${id} is not implemented.`,
  );
  assert.equal(entry?.acceptanceStatus, "verified", `${id} is not verified.`);
  assert.ok(entry?.implementationPaths?.length >= 6);
  assert.ok(entry?.testPaths?.length >= 3);
}
const crm = evidence.filter((entry) => entry.module === "CRM");
const counts = crm.reduce((result, entry) => {
  result[entry.registerStatus] = (result[entry.registerStatus] || 0) + 1;
  return result;
}, {});
assert.deepEqual(counts, {
  Implemented: 83,
});

const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.ok(rootPackage.scripts["verify:crm-07"]);
assert.ok(rootPackage.scripts["verify:crm-07-complete"]);
assert.ok(rootPackage.scripts["test:crm-07-live"]);
const webPackage = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
assert.ok(webPackage.scripts["crm:marketing-execution:live"]);
assert.match(
  fs.readFileSync("services/api/src/index.js", "utf8"),
  /marketing-execution/,
);
assert.match(
  fs.readFileSync("services/api/src/index.d.ts", "utf8"),
  /marketing-execution/,
);
assert.match(
  fs.readFileSync("apps/web/src/components/app-shell.tsx", "utf8"),
  /\/crm\/marketing/,
);
assert.match(
  fs.readFileSync("apps/mobile/src/core/modules/navigation.ts", "utf8"),
  /crm-marketing/,
);
assert.match(
  fs.readFileSync("apps/mobile/src/core/modules/web-parity.ts", "utf8"),
  /\/crm\/marketing/,
);
assert.match(
  fs.readFileSync(
    "apps/web/src/app/api/mobile/v1/workspace\/\[area\]\/route.ts",
    "utf8",
  ),
  /crm-marketing/,
);

console.log("CRM-07 marketing execution contract verified.");
