import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F001 Pass 2B web: Lead 360 composes governance and intelligence evidence without exposing raw provenance payloads", () => {
  const loader = read("src/modules/crm/server/lead-detail-data.ts");
  for (const table of [
    "crm_lead_provenance",
    "crm_consent_events",
    "crm_enrichment_reviews",
    "crm_lead_sla_cases",
    "crm_lead_sla_events",
    "crm_data_quality_scores",
    "crm_ai_predictions",
  ]) assert.match(loader, new RegExp(table));
  assert.match(loader, /crm\.privacy\.manage/);
  assert.match(loader, /crm\.data-quality\.manage/);
  assert.match(loader, /crm\.ai\.manage/);
  assert.doesNotMatch(loader, /original_payload/);
});


test("F001 Pass 2B web: governance section exposes consent, SLA, enrichment and explainable AI workflows", () => {
  const detail = read("src/modules/crm/components/lead-detail-workspace.tsx");
  assert.match(detail, /"governance"/);
  assert.match(detail, /Governance & AI/);
  assert.match(detail, /Provenance and consent evidence/);
  assert.match(detail, /Record immutable event/);
  assert.match(detail, /\/api\/crm\/consent-events/);
  assert.match(detail, /\/api\/crm\/lead-intelligence\/sla/);
  assert.match(detail, /\/api\/crm\/lead-acquisition\/enrichment/);
  assert.match(detail, /Score explanation and AI predictions/);
  assert.match(detail, /model_provider/);
  assert.match(detail, /model_version/);
});


test("F001 Pass 2B web: privacy and data-quality controls are threaded through full-page and drawer Lead 360", () => {
  const fullPage = read("src/app/(app)/crm/leads/[id]/page.tsx");
  const resourcePage = read("src/app/(app)/crm/[resource]/page.tsx");
  const manager = read("src/modules/crm/components/resource-manager.tsx");
  for (const source of [fullPage, resourcePage]) {
    assert.match(source, /crmPrivacyManage/);
    assert.match(source, /crmDataQualityManage/);
  }
  assert.match(manager, /canManagePrivacy/);
  assert.match(manager, /canManageDataQuality/);
  assert.match(manager, /provenance/);
  assert.match(manager, /consentEvents/);
  assert.match(manager, /enrichmentReviews/);
  assert.match(manager, /slaCases/);
  assert.match(manager, /dataQuality/);
  assert.match(manager, /aiPredictions/);
});


test("F001 Pass 2B web: restricted Lead 360 still collapses to non-sensitive tabs", () => {
  const detail = read("src/modules/crm/components/lead-detail-workspace.tsx");
  assert.match(detail, /sensitiveDataRestricted\s*\?\s*\["overview", "opportunities"\]/);
  assert.match(detail, /Consent evidence is limited to privacy managers/);
  assert.match(detail, /Data-quality evidence is limited to data-quality managers/);
});
