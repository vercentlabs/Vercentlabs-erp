// Integrity closeout (Prompts 1-5): CRM_OPPORTUNITY_STAGE_EXIT_BLOCKED now
// carries a structured missingRequirements list from the domain layer
// (services/api/src/modules/crm/index.js's moveOpportunityStage), but
// rethrowCrmError previously dropped CrmError.details entirely when
// converting to HttpError — the client only ever saw the generic message,
// never which specific stage-exit requirement was missing. http.ts imports
// next/server (NextResponse), which the plain-TS loader used elsewhere in
// this suite cannot resolve, so this is a source-structure test rather
// than a behavioral one — matching this repo's established convention for
// framework-coupled files (see e.g. apps/web/tests/crm-leads-f001-wave1.test.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("HttpError accepts and stores an optional details payload", () => {
  const source = read("apps/web/src/core/http.ts");
  assert.match(source, /class HttpError extends Error \{[\s\S]*public readonly details\?: Record<string, unknown>/);
});

test("failWithCode merges HttpError.details into the response body alongside code", () => {
  const source = read("apps/web/src/core/http.ts");
  assert.match(source, /function failWithCode\(error: HttpError\) \{[\s\S]*error\.details/);
});

test("rethrowCrmError forwards error.details onto the new HttpError, not just status/message/code", () => {
  const source = read("apps/web/src/modules/crm/crm-data-operations-and-customization/http-errors.ts");
  assert.match(
    source,
    /throw new HttpError\(\s*error\.status,\s*error\.message,\s*error\.code,\s*[\s\S]*?error as \{ details\?: Record<string, unknown> \}\)\.details/,
  );
});

test("the Opportunity 360 stage-transition dialog surfaces missingRequirements in its error message, not just the generic message", () => {
  const source = read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-actions.tsx");
  assert.match(source, /missingRequirements/);
  assert.match(source, /Missing: \$\{missingRequirements\.join/);
});

test("the pipeline board's stage-move handler also surfaces missingRequirements", () => {
  const source = read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/pipeline-board.tsx");
  assert.match(source, /missingRequirements/);
  assert.match(source, /Missing: \$\{missingRequirements\.join/);
});
