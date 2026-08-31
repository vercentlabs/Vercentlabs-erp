import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("F010 web: pipeline page chooses one visible pipeline and reads only its open scoped opportunities", () => {
  const page = read("apps/web/src/app/(app)/crm/pipeline/page.tsx");
  assert.match(page, /requestedPipelineId/);
  assert.match(page, /pipelines\.find\(\(pipeline\) => pipeline\.id === requestedPipelineId\)/);
  assert.match(page, /String\(stage\.pipelineId\) === selectedPipelineId/);
  assert.match(page, /pipelineId: selectedPipelineId/);
  assert.match(page, /status: "open"/);
  assert.match(page, /listCrmRecords\(client, context, "opportunities"/);
});

test("F010 web: board provides pipeline selection, drag and keyboard-select movement without cross-pipeline stage choices", () => {
  const board = read("apps/web/src/modules/crm/components/pipeline-board.tsx");
  assert.match(board, /aria-label="Select opportunity pipeline"/);
  assert.match(board, /router\.push\(/);
  assert.match(board, /onDragStart/);
  assert.match(board, /onDrop/);
  assert.match(board, /aria-label={`Move \$\{row\.name\} to stage`}/);
  assert.match(board, /orderedStages\.map/);
});

test("F010 web: every direct board move carries stale-write expectations", () => {
  const board = read("apps/web/src/modules/crm/components/pipeline-board.tsx");
  assert.match(board, /expectedUpdatedAt: opportunity\.updatedAt/);
  assert.match(board, /expectedStageId: opportunity\.stageId/);
  const actions = read("apps/web/src/modules/crm/components/opportunity-actions.tsx");
  assert.match(actions, /expectedUpdatedAt: updatedAt/);
  assert.match(actions, /expectedStageId: stageId/);
});

test("F010 web: terminal move collects a valid won/lost reason before POST", () => {
  const board = read("apps/web/src/modules/crm/components/pipeline-board.tsx");
  assert.match(board, /stage\.isWon \|\| stage\.isLost/);
  assert.match(board, /outcomeReasonId: outcome\?\.reasonId \|\| null/);
  assert.match(board, /outcomeNotes: outcome\?\.notes \|\| null/);
  assert.match(board, /No active \{closeRequest\.outcomeType\} reason is configured/);
});

test("F010 web: canonical route preserves same-origin, permission, billing, transaction, validation and audit", () => {
  const route = read("apps/web/src/app/api/crm/opportunities/[id]/stage/route.ts");
  assert.match(route, /assertSameOrigin\(request\)/);
  assert.match(route, /PERMISSIONS\.crmOpportunitiesManage/);
  assert.match(route, /requireBillingWriteAccess/);
  assert.match(route, /moveStageSchema\.parse/);
  assert.match(route, /tenantTransaction/);
  assert.match(route, /moveOpportunityStage/);
  assert.match(route, /expectedUpdatedAt: input\.expectedUpdatedAt/);
  assert.match(route, /expectedStageId: input\.expectedStageId/);
  assert.match(route, /eventType: "crm\.opportunity\.stage_changed"/);
});

test("F010 web: opportunity detail cannot offer another pipeline's stage and passes the record version", () => {
  const detail = read("apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx");
  assert.match(detail, /String\(stage\.pipelineId\) === String\(record\.pipelineId\)/);
  assert.match(detail, /updatedAt=\{String\(record\.updatedAt\)\}/);
});

test("F010 web: approval path validates and executes with the same concurrency expectations", () => {
  const approvals = read("apps/web/src/orchestration/approvals.ts");
  const start = approvals.indexOf('key: "crm.opportunity.stage_change"');
  const end = approvals.indexOf('key: "crm.activity.complete"', start);
  const block = approvals.slice(start, end);
  assert.match(block, /expectedUpdatedAt: z\.string\(\)\.datetime/);
  assert.match(block, /expectedStageId: uuid\.optional\(\)\.nullable\(\)/);
  assert.match(block, /expectedUpdatedAt: payload\.expectedUpdatedAt/);
  assert.match(block, /expectedStageId: payload\.expectedStageId/);
});

test("F010 documentation remains canonical and NOT_READY until production acceptance", () => {
  const spec = read("docs/03-modules/crm/features/F010-opportunity-pipeline.md");
  assert.match(spec, /Canonical ID: `F010`/);
  assert.match(spec, /Canonical name: \*\*Opportunity pipeline\*\*/i);
  assert.match(spec, /Implementation status: `NOT_STARTED`/);
  assert.match(spec, /Product status: `NOT_READY`/);
});
