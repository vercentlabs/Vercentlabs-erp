// CRM vNext Prompt 6 (F019 — Activity Timeline). Account and Contact 360
// previously had NO timeline/history at all (confirmed by an Explore-agent
// audit: zero matches for timeline/history/activit/communicat in either
// detail-data server file or workspace component). This closes that gap
// using the ONE canonical cross-entity projection (getCrmRecordTimelinePage,
// services/api/.../seller-activity-and-follow-up-workspace/timeline/
// timeline.js) rather than a third/fourth hand-rolled implementation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("F019: the Account timeline route uses the canonical projection scoped to entityType 'party', gated on ordinary crm.view (the domain function enforces the real sensitive-content gate)", () => {
  const source = read("apps/web/src/app/api/crm/accounts/[id]/timeline/route.ts");
  assert.match(source, /getCrmRecordTimelinePage/);
  assert.match(source, /"party"/);
  assert.match(source, /requireCrmView/);
  assert.match(source, /assertCrmIdentifier/);
});

test("F019: the Contact timeline route uses the canonical projection scoped to entityType 'contact'", () => {
  const source = read("apps/web/src/app/api/crm/contacts/[id]/timeline/route.ts");
  assert.match(source, /getCrmRecordTimelinePage/);
  assert.match(source, /"contact"/);
  assert.match(source, /requireCrmView/);
  assert.match(source, /assertCrmIdentifier/);
});

test("F019: Account 360 renders the shared TimelinePanel against its own timeline endpoint", () => {
  const source = read("apps/web/src/modules/crm/prospect-and-relationship-master-data/account-detail-workspace.tsx");
  assert.match(source, /import TimelinePanel from "@\/modules\/crm\/seller-activity-and-follow-up-workspace\/timeline-panel";/);
  assert.match(source, /<TimelinePanel endpoint=\{`\/api\/crm\/accounts\/\$\{String\(account\.id\)\}\/timeline`\}\s*\/>/);
});

test("F019: Contact 360 renders the shared TimelinePanel against its own timeline endpoint", () => {
  const source = read("apps/web/src/modules/crm/prospect-and-relationship-master-data/contact-detail-workspace.tsx");
  assert.match(source, /import TimelinePanel from "@\/modules\/crm\/seller-activity-and-follow-up-workspace\/timeline-panel";/);
  assert.match(source, /<TimelinePanel endpoint=\{`\/api\/crm\/contacts\/\$\{String\(contact\.id\)\}\/timeline`\}\s*\/>/);
});

test("F019: the shared TimelinePanel supports cursor-based 'load older' pagination, not an unbounded fetch-everything call", () => {
  const source = read("apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/timeline-panel.tsx");
  assert.match(source, /nextCursor/);
  assert.match(source, /hasMore/);
  assert.match(source, /Load older/);
  // Never fetches without a bound — the endpoint prop alone (page 1) or with
  // an explicit cursor, never a raw "fetch entire history" call.
  assert.doesNotMatch(source, /limit=10000|limit=Infinity/);
});

test("F019: getCrmRecordTimelinePage is exported from the public @vercentlabs/api surface with a typed declaration", () => {
  const barrel = read("services/api/src/modules/crm/index.js");
  assert.match(barrel, /getCrmTimelinePage as getCrmRecordTimelinePage/);
  const types = read("services/api/src/index.d.ts");
  assert.match(types, /export function getCrmRecordTimelinePage/);
});
