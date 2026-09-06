import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F001 Wave 1 web: generic Lead edit and archive propagate the loaded version", () => {
  const manager = read("src/modules/crm/components/resource-manager.tsx");
  assert.match(manager, /body\.expectedUpdatedAt = expectedUpdatedAt/);
  assert.match(manager, /expectedUpdatedAt=\$\{encodeURIComponent/);
});

test("F001 Wave 1 web: Kanban and detail lifecycle transitions send expectedUpdatedAt", () => {
  const board = read("src/modules/crm/components/leads-workspace.tsx");
  const detail = read("src/modules/crm/components/lead-detail-workspace.tsx");
  assert.match(board, /boardRows\.find[\s\S]*expectedUpdatedAt[\s\S]*source: "kanban"/);
  assert.match(detail, /source: "manual"[\s\S]*expectedUpdatedAt/);
});

test("F001 Wave 1 web: owner assignment sends expectedUpdatedAt and generic editor does not mix owner mutation", () => {
  const board = read("src/modules/crm/components/leads-workspace.tsx");
  const detail = read("src/modules/crm/components/lead-detail-workspace.tsx");
  assert.doesNotMatch(board, /\["companyId", "branchId", "sourceId"(, "[a-zA-Z]+")*, "ownerUserId"\]/);
  assert.match(board, /\["companyId", "branchId", "sourceId", "referrerName"\]/);
  assert.match(detail, /ownerUserId: selected\.id,[\s\S]*expectedUpdatedAt/);
});

test("F001 Wave 1 API routes: Lead PATCH, archive, assignment and stage require a version token", () => {
  const item = read("src/app/api/crm/[resource]/[id]/route.ts");
  const assign = read("src/app/api/crm/leads/[id]/assign/route.ts");
  const stage = read("src/app/api/crm/leads/[id]/stage/route.ts");
  const status = read("src/app/api/crm/leads/[id]/status/route.ts");
  const mobileItem = read("src/app/api/mobile/v1/crm/[resource]/[id]/route.ts");
  for (const source of [item, assign, stage, status, mobileItem]) {
    assert.match(source, /CRM_LEAD_VERSION_REQUIRED/);
    assert.match(source, /expectedUpdatedAt/);
  }
  assert.match(stage, /requireVersion: true/);
  assert.match(status, /requireVersion: true/);
  assert.match(assign, /requireVersion: true/);
  assert.match(item, /requireVersion: true/);
  assert.match(mobileItem, /requireVersion: true/);
});
