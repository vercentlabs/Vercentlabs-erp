import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F019 web: getLeadTimelinePage re-checks Lead visibility, respects the sensitivity gate and bounds its page size", () => {
  const source = read("src/modules/crm/server/lead-detail-data.ts");
  assert.match(source, /export async function getLeadTimelinePage/);
  assert.match(source, /await getCrmRecord\(client, context, "leads", id\)/);
  assert.match(source, /if \(!canViewSensitiveLeadContent\(context\)\) return \{ rows: \[\], hasMore: false \}/);
  assert.match(source, /Math\.max\(1, Math\.min\(100, Math\.trunc\(limit\) \|\| 50\)\)/);
  assert.match(source, /LIMIT \$3 OFFSET \$4/);
  assert.match(source, /boundedLimit \+ 1/);
  assert.match(source, /const hasMore = result\.rows\.length > boundedLimit/);
});

test("F019 web: the timeline route is authenticated, permission-gated and validates its source parameter", () => {
  const route = read("src/app/api/crm/leads/[id]/timeline/route.ts");
  assert.match(route, /requireCrmView\(session\)/);
  assert.match(route, /getLeadTimelinePage/);
  assert.match(route, /source !== "activities" && source !== "communications"/);
  assert.match(route, /CRM_LEAD_TIMELINE_SOURCE_INVALID/);
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
  assert.match(workspace, /\[activityRows, communicationRows, notes, opportunities, lifecycleHistory\]/);
});
