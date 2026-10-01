import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Characterization of the Lead detail screen after it was split into
// detail/ components (Prompt 10). The facts below were captured from the
// single-file screen before the split; the screen, its data hook and its tab
// and dialog components must keep exactly the same reads, writes, cache
// invalidations, tabs, permission gates and dialogs.
const read = (relative: string) =>
  fs.readFileSync(new URL(relative, import.meta.url), "utf8");
const src = [
  "../screens/LeadDetailScreen.tsx",
  "./useLeadDetailData.ts",
  "./lead-detail-shared.tsx",
  "./LeadOverviewTab.tsx",
  "./LeadQualificationTab.tsx",
  "./LeadPipelineTab.tsx",
  "./LeadIntelligenceTab.tsx",
  "./LeadPrivacyTab.tsx",
  "./ConvertLeadDialog.tsx",
  "./LeadPrivacyRequestDialog.tsx",
]
  .map(read)
  .join("\n");
const norm = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/,\s*\)/g, ")")
    .trim();
const all = (re: RegExp) => [...src.matchAll(re)].map((m) => norm(m[1]));
const facts = {
  queryKeys: all(
    /queryKey:\s*(scopedQueryKey\([^;]*?\))\s*,\s*(?:queryFn|\})/g,
  ),
  enabled: all(/enabled:\s*([^,\n]+),/g),
  queryFns: all(/queryFn:\s*([^,]+?),\s*\n/g),
  mutationFns: all(/mutationFn:\s*\(\)\s*=>\s*\n?\s*([A-Za-z]+)\(/g),
  invalidations: all(
    /invalidateQueries\(\{\s*queryKey:\s*(scopedQueryKey\([^;]*?\))\s*,?\s*\}\)/g,
  ),
  tabs: all(/<Tab id="([a-z-]+)">/g),
  tabPanels: all(/<TabPanel id="([a-z-]+)">/g),
  permissions: all(/CRM_PERMISSIONS\.([A-Za-z]+)/g),
  dialogsTitles: all(/title="([^"]+)"/g),
  apiCalls: [
    ...new Set(
      all(
        /\b((?:get|list|assign|convert|decide|recalculate|transition|create)(?:Lead|Crm|Consent|Privacy)[A-Za-z]*)\(/g,
      ),
    ),
  ].sort(),
};

const expected = {
  queryKeys: [
    'scopedQueryKey( workspace, "crm", "leads", leadId, "consent-events")',
    'scopedQueryKey( workspace, "crm", "leads", leadId, "convert-preview")',
    'scopedQueryKey( workspace, "crm", "leads", leadId, "qualification")',
    'scopedQueryKey( workspace, "crm", "leads", leadId, "qualification")',
    'scopedQueryKey( workspace, "crm", "leads", leadId, "stage-detail")',
    'scopedQueryKey( workspace, "crm", "leads", leadId, "stage-reasons", pendingStageId)',
    'scopedQueryKey(workspace, "crm", "leads")',
    'scopedQueryKey(workspace, "crm", "leads", "transition-graph")',
    'scopedQueryKey(workspace, "crm", "leads", leadId)',
    'scopedQueryKey(workspace, "crm", "leads", leadId)',
    'scopedQueryKey(workspace, "crm", "leads", leadId, "attribution")',
    'scopedQueryKey(workspace, "crm", "leads", leadId, "score")',
    'scopedQueryKey(workspace, "crm", "leads", leadId, "score")',
    'scopedQueryKey(workspace, "crm", "leads", leadId, "stage-detail")',
    'scopedQueryKey(workspace, "crm", "options")',
  ],
  enabled: [
    "Boolean(lead)",
    "Boolean(lead)",
    "Boolean(lead)",
    "Boolean(lead)",
    "Boolean(lead)",
    "Boolean(pendingStageId)",
    "convertPreviewOpen",
  ],
  queryFns: [
    "() => getLead(leadId)",
    "() => getLeadAttribution(leadId)",
    "() => getLeadConversionPreview(leadId)",
    "() => getLeadQualificationDetail(leadId)",
    "() => getLeadScoreDetail(leadId)",
    "() => getLeadStageDetail(leadId)",
    "() => listConsentEvents(leadId)",
    "getCrmOptions",
    "getLeadTransitionGraph",
  ],
  mutationFns: [
    "assignLead",
    "convertLead",
    "createPrivacyRequest",
    "decideLeadQualification",
    "recalculateLeadScore",
    "transitionLeadStage",
  ],
  invalidations: [
    'scopedQueryKey( workspace, "crm", "leads", leadId, "qualification")',
    'scopedQueryKey( workspace, "crm", "leads", leadId, "stage-detail")',
    'scopedQueryKey(workspace, "crm", "leads")',
    'scopedQueryKey(workspace, "crm", "leads", leadId)',
    'scopedQueryKey(workspace, "crm", "leads", leadId, "score")',
  ],
  tabs: [
    "overview",
    "qualification",
    "pipeline",
    "intelligence",
    "privacy",
    "activity",
    "communications",
    "notes",
    "attachments",
    "custom-fields",
  ],
  tabPanels: [
    "overview",
    "qualification",
    "pipeline",
    "intelligence",
    "privacy",
    "activity",
    "communications",
    "notes",
    "attachments",
    "custom-fields",
  ],
  permissions: ["dataQualityManage", "leadsManage"],
  dialogsTitles: [
    "Company and interest",
    "Contact",
    "Convert this Lead",
    "Could not load this Lead",
    "Lead not found",
    "New privacy request for this Lead",
    "Sales flow",
    "You don't have access to this Lead",
  ],
  apiCalls: [
    "assignLead",
    "convertLead",
    "createPrivacyRequest",
    "decideLeadQualification",
    "getLead",
    "getLeadAttribution",
    "getLeadConversionPreview",
    "getLeadQualificationDetail",
    "getLeadScoreDetail",
    "getLeadStageDetail",
    "getLeadStageReasons",
    "listConsentEvents",
    "recalculateLeadScore",
    "transitionLeadStage",
  ],
};

// Layout-independent: Prettier may wrap a call differently after a move.
const tidy = (values: readonly string[]) =>
  values.map((value) => value.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")"));

for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
  test(`Lead detail keeps its ${key}`, () => {
    const ordered = ["tabs", "tabPanels", "apiCalls"].includes(key);
    const actual = tidy(ordered ? facts[key] : [...facts[key]].sort());
    assert.deepEqual(
      ordered ? actual : actual.sort(),
      ordered ? tidy(expected[key]) : tidy(expected[key]).sort(),
    );
  });
}
