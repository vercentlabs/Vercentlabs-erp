import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F019 §16 web: the dead, superseded getLeadTimelinePage/getLeadTimeline implementations are gone — Lead's timeline no longer has its own hand-rolled pagination/security engine", () => {
  const leadDetailData = read("src/modules/crm/server/lead-detail-data.ts");
  assert.doesNotMatch(leadDetailData, /export async function getLeadTimelinePage/);
  const leadOperations = read("../../services/api/src/modules/crm/lead-operations.js");
  assert.doesNotMatch(leadOperations, /export async function getLeadTimeline\(/, "the broken duplicate implementation (querying the nonexistent tenant.crm_lead_conversions table) must not remain");
});

test("F019 §16 web: the timeline route delegates to the canonical Timeline domain module (getCrmTimelinePageBySource), the SAME one Account/Contact/Opportunity's Timeline routes use — not a Lead-only reimplementation", () => {
  const route = read("src/app/api/crm/leads/[id]/timeline/route.ts");
  assert.match(route, /requireCrmView\(session\)/);
  assert.match(route, /getCrmTimelinePageBySource/);
  assert.match(route, /from "@vercentlabs\/api"/);
  assert.match(route, /getCrmTimelinePageBySource\(client, context, "lead", id/);
  assert.doesNotMatch(route, /getLeadTimelinePage/);
  assert.match(route, /CRM_LEAD_TIMELINE_SOURCE_INVALID/);
});

test("F019 §16 api: getCrmTimelinePageBySource reuses the SAME resolveCrmEntityAccess gate and the SAME visibility predicate as the unified Timeline's buildBranch — one authorization implementation per kind, not two", () => {
  const domain = read("../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/timeline/timeline.js");
  assert.match(domain, /export async function getCrmTimelinePageBySource/);
  const fn = domain.match(/export async function getCrmTimelinePageBySource[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(fn, /await resolveCrmEntityAccess\(client, context, entityType, entityId\)/);
  assert.match(fn, /buildSourceQuery\(source, entityType, entityId, context, values\)/);
  // Both the merged-feed envelope builder and the single-kind full-row
  // builder call the SAME visibilityPredicate function — pinning that a
  // private communication/note cannot be visible through one path and
  // hidden through the other.
  const visibilityCallers = domain.match(/visibilityPredicate\(/g) || [];
  assert.ok(visibilityCallers.length >= 3, "expected visibilityPredicate to be defined once and called from both buildBranch and buildSourceQuery");
});

test("F019 §16 api: getCrmTimelinePageBySource preserves full row detail (not the narrow merged-feed envelope) — Lead's Activities/Communications tabs still render assignee name, description, direction, provider and body", () => {
  const domain = read("../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/timeline/timeline.js");
  const fn = domain.match(/function buildSourceQuery[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(fn, /a\.\*,u\.full_name AS assigned_name/, "activity rows must keep every original column plus the assignee name join");
  assert.match(fn, /SELECT communication\.\* FROM tenant\.crm_communications AS communication/, "communication rows must keep every original column (channel/direction/provider/body), not a narrowed envelope");
});

test("F019 web: activities and communications are appendable client state with a Load older control on every tab that shows them", () => {
  const workspace = read("src/modules/crm/components/lead-detail-workspace.tsx");
  assert.match(workspace, /const \[activityRows, setActivityRows\] = useState\(activities\)/);
  assert.match(workspace, /const \[communicationRows, setCommunicationRows\] = useState\(communications\)/);
  assert.match(workspace, /async function loadOlderTimelineItems\(source: "activities" \| "communications"\)/);
  assert.match(workspace, /\/api\/crm\/leads\/\$\{id\}\/timeline\?source=\$\{source\}&offset=\$\{rows\.length\}&limit=50/);
  const loadMoreOccurrences = workspace.match(/void loadOlderTimelineItems\(/g) || [];
  // Timeline tab conditionally calls both sources (2 call sites in one
  // handler) plus one call site each on the Activities and Communications
  // tabs.
  assert.equal(loadMoreOccurrences.length, 4, "expected Load older controls on the Timeline, Activities and Communications tabs");
  assert.match(workspace, /Load older activities/);
  assert.match(workspace, /Load older communications/);
  assert.match(workspace, /Load older timeline events/);
  // The merged Timeline memo must read from the appendable state, not the
  // original server-rendered props, or "Load older" would have no effect on it.
  assert.match(workspace, /\.\.\.activityRows\.map\(\(row\) => \(\{/);
  assert.match(workspace, /\.\.\.communicationRows\.map\(\(row\) => \(\{/);
  assert.match(workspace, /\[activityRows, communicationRows, notes, opportunities, lifecycleHistory, attachments\]/);
});

test("F019 §16 web: getLeadDetailData's INITIAL communications query applies the private-visibility predicate — a real gap found during the F019 migration where page-load leaked private communications that 'load older' already correctly hid", () => {
  const source = read("src/modules/crm/server/lead-detail-data.ts");
  const initialQuery = source.match(/SELECT \* FROM tenant\.crm_communications WHERE organization_id=\$1 AND lead_id=\$2[\s\S]*?LIMIT 200`/)?.[0] || "";
  assert.match(initialQuery, /visibility<>'private' OR created_by=\$3 OR \$4/);
});

test("F019 web: the merged Timeline includes governed file uploads (attachments), closing the one event type it was still missing", () => {
  const workspace = read("src/modules/crm/components/lead-detail-workspace.tsx");
  assert.match(workspace, /\.\.\.attachments\.map\(\(row\) => \(\{/);
  assert.match(workspace, /__kind: "File"/);
});
