import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F029 web: the operations route wires cancel/retry actions to the governed domain functions", () => {
  const route = read("src/app/api/crm/leads/operations/route.ts");
  assert.match(route, /cancelLeadBulkJob/);
  assert.match(route, /retryFailedLeadBulkJobItems/);
  assert.match(route, /input\.action === "cancel-bulk-job"/);
  assert.match(route, /input\.action === "retry-bulk-job"/);
});

test("F029 web: the bulk job panel offers Cancel while in flight and Retry only when there are failed rows", () => {
  const workspace = read("src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx");
  assert.match(workspace, /async function cancelBulkJob/);
  assert.match(workspace, /async function retryFailedBulkJobItems/);
  assert.match(workspace, /action: "cancel-bulk-job", jobId: bulkJob\.id/);
  assert.match(workspace, /action: "retry-bulk-job", jobId: bulkJob\.id/);
  assert.match(workspace, /bulkJob\.status === "pending" \|\| bulkJob\.status === "processing"/);
  assert.match(
    workspace,
    /\(bulkJob\.status === "completed" \|\| bulkJob\.status === "dead"\) &&\s*\n\s*Number\(bulkJob\.progress\?\.failed \|\| bulkJob\.resultManifest\?\.failed \|\| 0\) > 0/,
  );
  assert.match(workspace, /"cancelled"/);
});
