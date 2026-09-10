import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// F023 (Opportunity-to-quotation conversion) — LAST PROMPT 1/3 closeout:
// F023-INT-001 explicitly requires an idempotency key on the CRM->Sales
// quotation-creation handoff; none existed. Reuses the shared
// services/api/src/core/idempotency.js utility (already used by Stock/
// Quality/POS/Manufacturing — proven, not new infra) rather than inventing
// a second mechanism. Source-assertion here: previewSalesDocument (called
// before the idempotency reservation, since it resolves the company id the
// reservation needs) has enough internal query/pricing complexity that a
// full behavioral mock risks silently drifting from real behavior — the
// same category of complexity that made services/api/tests/
// crm-lead-bulk-update.test.mjs (worker) settle for source-assertion
// against updateCrmRecord's internals.

test("F023: createQuotation reserves an idempotency key before the INSERT, using the shared utility every other module uses", () => {
  const source = read("src/modules/sales/index.js");
  assert.match(source, /import \{ beginIdempotentOperation, completeIdempotentOperation \} from "\.\.\/\.\.\/core\/idempotency\.js";/);
  const fnStart = source.indexOf("export async function createQuotation(");
  const beginIdx = source.indexOf("beginIdempotentOperation(", fnStart);
  const insertIdx = source.indexOf("INSERT INTO tenant.sales_quotations", fnStart);
  assert.ok(fnStart > 0 && beginIdx > fnStart && insertIdx > beginIdx, "idempotency reservation must happen before the INSERT");
});

test("F023: a replayed key short-circuits before any INSERT/event, returning the original response", () => {
  const source = read("src/modules/sales/index.js");
  const fnStart = source.indexOf("export async function createQuotation(");
  const fnBody = source.slice(fnStart, source.indexOf("\nexport async function reviseQuotation", fnStart));
  assert.match(fnBody, /if \(idempotency\.replayed\) return \{ \.\.\.idempotency\.response, replayed: true \};/);
});

test("F023: the key is optional (required: false / omitted) so every existing caller without one is unaffected", () => {
  const source = read("src/modules/sales/index.js");
  const fnStart = source.indexOf("export async function createQuotation(");
  const beginCallEnd = source.indexOf(");", source.indexOf("beginIdempotentOperation(", fnStart));
  const beginCall = source.slice(source.indexOf("beginIdempotentOperation(", fnStart), beginCallEnd);
  assert.doesNotMatch(beginCall, /required:\s*true/);
});

test("F023: the reservation is completed (finalized) only after the quotation, its version and its creation event all succeed", () => {
  const source = read("src/modules/sales/index.js");
  const fnStart = source.indexOf("export async function createQuotation(");
  const fnEnd = source.indexOf("\nexport async function reviseQuotation", fnStart);
  const fnBody = source.slice(fnStart, fnEnd);
  const completeIdx = fnBody.indexOf("completeIdempotentOperation(");
  const eventIdx = fnBody.indexOf('"quotation.created"');
  const versionIdx = fnBody.indexOf("insertQuotationVersion(");
  assert.ok(completeIdx > eventIdx && completeIdx > versionIdx, "completion must be the last step, after the version and event are both durable");
  assert.match(fnBody, /aggregateType: "sales_quotation"/);
});
