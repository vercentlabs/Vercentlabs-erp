import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("F007 exposes governed lifecycle APIs and Setup surface", async () => {
  const [setup, catalogue, stageRoute, transitionRoute] = await Promise.all([
    read("src/app/(app)/crm/settings/page.tsx"),
    read("src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-lifecycle-workspace.tsx"),
    read("src/app/api/crm/lead-stages/[id]/route.ts"),
    read("src/app/api/crm/leads/[id]/stage/route.ts"),
  ]);
  assert.match(setup, /Lead lifecycle/);
  assert.match(setup, /Lead management/);
  assert.match(catalogue, /Add stage/);
  assert.match(catalogue, /Deactivate/);
  assert.match(catalogue, /Reactivate/);
  assert.match(catalogue, /Lifecycle is not qualification/);
  assert.match(stageRoute, /crmSettingsManage/);
  assert.match(transitionRoute, /transitionLeadStage/);
  assert.match(transitionRoute, /crmLeadsManage/);
});

test("F007 Kanban and Lead detail use dynamic stages and canonical transition endpoint", async () => {
  const [board, detail, create] = await Promise.all([
    read("src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx"),
    read("src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx"),
    read("src/modules/crm/prospect-and-relationship-master-data/lead-create-workspace.tsx"),
  ]);
  assert.match(board, /options\.leadStages/);
  assert.match(board, /\/stage`/);
  assert.match(board, /allowedFromCodes/);
  assert.match(board, /onDragStart/);
  assert.match(board, /Move lead/);
  assert.match(detail, /lifecycleHistory/);
  assert.match(detail, /recordStatus/);
  assert.doesNotMatch(create, /name="status"/);
});

test("F007 lifecycle Setup is responsive and right-sided", async () => {
  const moduleCss = await read("src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-lifecycle-workspace.module.css");
  const canonicalCss = await read("src/modules/crm/ui/crm.css");
  assert.match(moduleCss, /@media \(max-width: 767px\)/);
  assert.match(moduleCss, /min-height: 44px/);
  assert.match(canonicalCss, /100dvh/);
  assert.match(canonicalCss, /prefers-reduced-motion/);
});

test("F007 native capture and shared follow-ups use governed lifecycle boundaries", async () => {
  const capture = await read("../mobile/src/modules/crm/components/lead-capture.tsx");
  const detail = await read("../mobile/src/app/(protected)/crm/[resource]/[id].tsx");
  const manager = await read("../mobile/src/shared/components/resource-manager-screen.tsx");
  // Follow-ups (F016) was rewired 2026-09-05 to read the lead nurture queue
  // instead of filtering raw lead rows client-side; the same
  // active/qualified-only guarantee now lives in evaluateNurtureEligibility
  // (checked when a lead is added to the queue, not when it's read back).
  const leadIntelligence = await read("../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js");
  assert.doesNotMatch(capture, /status:\s*"new"/);
  assert.match(detail, /record\.recordStatus !== "converted"/);
  assert.match(detail, /record\.recordStatus !== "archived"/);
  assert.match(manager, /options\.leadStages/);
  assert.doesNotMatch(manager, /"qualified", "unqualified"/);
  assert.match(manager, /resource !== "leads" \|\| !\["status", "qualificationState", "unqualifiedReason"\]/);
  assert.doesNotMatch(manager, /name,email,status/);
  assert.match(
    leadIntelligence,
    /\["converted", "archived"\]\.includes\(text\(lead\.record_status\)\) \|\|\s*\n\s*text\(lead\.qualification_state\) === "unqualified"/,
  );
});
