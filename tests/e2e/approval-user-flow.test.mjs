import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("approval requests are discoverable and can be initiated before decision", () => {
  const shell = read("apps/web/src/components/app-shell.tsx");
  const opportunity = read(
    "apps/web/src/components/crm-opportunity-actions.tsx",
  );
  const activities = read("apps/web/src/components/crm-resource-manager.tsx");
  const collection = read("apps/web/src/app/api/approvals/route.ts");
  const decision = read("apps/web/src/app/api/approvals/[id]/route.ts");

  assert.match(shell, /href: "\/approvals"/);
  assert.match(shell, /PERMISSIONS\.approvalsManage/);
  assert.match(opportunity, /crm\.opportunity\.stage_change/);
  assert.match(activities, /crm\.activity\.complete/);
  assert.match(collection, /assertSameOriginOrMobile/);
  assert.match(collection, /approval\.requested/);
  assert.match(decision, /assertSeparationOfDuties/);
  assert.match(decision, /command\.execute/);
});

test("native mutation controls are permission-safe and support approval creation", () => {
  const sdk = read("packages/shared-sdk/src/mobile.js");
  const detail = read(
    "apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx",
  );
  const list = read("apps/mobile/src/shared/components/crm-list-screen.tsx");

  assert.match(sdk, /createApprovalRequest/);
  assert.match(detail, /crm\.opportunity\.stage_change/);
  assert.match(detail, /crm\.activity\.complete/);
  assert.match(detail, /canManageOpportunity/);
  assert.match(detail, /canManageActivity/);
  assert.match(detail, /canManageLead/);
  assert.match(list, /canManage\s*&&\s*resource === "activities"/);
});
