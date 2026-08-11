import fs from "node:fs";

function parseCsv(text) {
  const rows = []; let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += ch; }
    else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") {}
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length===1 && r[0]===""));
}

const text = fs.readFileSync("docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv", "utf8");
const table = parseCsv(text);
const header = table[0];
const rows = table.slice(1).map(r => Object.fromEntries(header.map((h,i)=>[h, r[i] ?? ""])));
const incomplete = rows.filter(r => r.status !== "COMPLETE");
const idOrder = new Map(rows.map((r,i) => [r.feature_id, i]));

const assignments = {}; // feature_id -> prompt number (string, may be "16" or "16,17" if split — we keep single here)
const claimed = new Set();

function assign(promptNumber, ids) {
  for (const id of ids) {
    if (claimed.has(id)) throw new Error(`Feature ${id} already assigned (double-claim at prompt ${promptNumber})`);
    if (!idOrder.has(id)) throw new Error(`Feature ${id} does not exist in the matrix`);
    claimed.add(id);
    assignments[id] = String(promptNumber);
  }
}

// ---------------------------------------------------------------------
// PROMPTS 16-23: shared/cross-cutting blockers first (Part 41)
// ---------------------------------------------------------------------

assign(16, [ // Quality-hold cross-module enforcement
  "QUAL-023", "QUAL-026", "QUAL-027", "QUAL-028", "QUAL-029", "QUAL-030", "QUAL-075",
]);

assign(17, [ // HR payroll correctness foundation (compensation assignment + real calculation)
  "HR-042", "HR-043", "HR-044", "HR-045", "HR-046", "HR-047", "HR-048", "HR-049",
  "HR-050", "HR-051", "HR-053", "HR-055",
]);

assign(18, [ // Stock costing-method + period-close correctness (P0 financial correctness)
  "STOCK-011", "STOCK-063", "STOCK-065", "STOCK-066", "STOCK-072",
]);

assign(19, [ // Universal write-UI framework foundation (representative anchors; unlocks module prompts below)
  "STOCK-021", "STOCK-022", "SUP-001", "POS-001", "QUAL-011", "ASSET-013", "PROJ-011", "MFG-033",
]);

assign(20, [ // Reporting/chart-library/BI foundation
  "SHARED-044", "SHARED-045", "SHARED-046", "SHARED-047", "SHARED-048", "SHARED-049",
  "SHARED-051", "SHARED-052", "SHARED-054",
]);

assign(21, [ // Integration/API-key/OAuth/webhook-signing foundation
  "SHARED-055", "SHARED-057", "SHARED-058", "SHARED-059", "SHARED-063", "SHARED-066",
]);

assign(22, [ // Data management breadth foundation (beyond CRM-only)
  "SHARED-084", "SHARED-086", "SHARED-089", "SHARED-093",
]);

assign(23, [ // Worker module-gating fix + webhook fan-out (deferred from Prompts 13/14) + MFA/SSO/record-level-access foundation
  "SHARED-017", "SHARED-021", "SHARED-022", "SHARED-024", "SHARED-016",
]);

// ---------------------------------------------------------------------
// Module completion campaigns — bucket each module's REMAINING
// incomplete features (after shared-blocker claims) into N prompts,
// grouping by the source category in original order, merging small
// adjacent categories to approximate a per-prompt target size.
// ---------------------------------------------------------------------

function remainingForModule(moduleName) {
  return incomplete
    .filter(r => r.module === moduleName && !claimed.has(r.feature_id))
    .sort((a, b) => idOrder.get(a.feature_id) - idOrder.get(b.feature_id));
}

function bucketByCategory(items, promptCount, startPrompt) {
  // Group in-order items by category, then greedily merge into promptCount buckets.
  const target = Math.ceil(items.length / promptCount);
  const buckets = [];
  let current = [];
  for (const item of items) {
    current.push(item);
    if (current.length >= target && buckets.length < promptCount - 1) {
      buckets.push(current);
      current = [];
    }
  }
  if (current.length) buckets.push(current);
  // If we ended up with fewer buckets than promptCount (small remainder), that's fine —
  // fewer prompts get used and the caller's promptCount is just an upper bound.
  buckets.forEach((bucket, i) => {
    assign(startPrompt + i, bucket.map(r => r.feature_id));
  });
  return buckets.length;
}

let next = 24;

next += bucketByCategory(remainingForModule("CRM"), 2, next);
next += bucketByCategory(remainingForModule("Sales"), 4, next);
next += bucketByCategory(remainingForModule("Procurement"), 4, next);
next += bucketByCategory(remainingForModule("Stock and Warehouse Management"), 6, next);
next += bucketByCategory(remainingForModule("Manufacturing"), 8, next);
next += bucketByCategory(remainingForModule("Projects"), 6, next);
next += bucketByCategory(remainingForModule("Assets"), 5, next);
next += bucketByCategory(remainingForModule("Point of Sale"), 6, next);
next += bucketByCategory(remainingForModule("Quality Management"), 5, next);
next += bucketByCategory(remainingForModule("Support and Customer Service"), 5, next);
next += bucketByCategory(remainingForModule("HR & Payroll"), 7, next);

// Shared remaining (after blockers 16/20/21/22/23 claimed their portions)
const sharedRemaining = incomplete
  .filter(r => r.scope === "shared" && !claimed.has(r.feature_id))
  .sort((a, b) => idOrder.get(a.feature_id) - idOrder.get(b.feature_id));
next += bucketByCategory(sharedRemaining, 3, next);

// Accounting (separate scope, not in the 1039 matrix — read straight from
// ERP_ACCOUNTING_MATRIX_011.csv's own incomplete rows)
const accIncomplete = [
  "ACC-034", "ACC-035", "ACC-036", "ACC-037", "ACC-038", "ACC-039", "ACC-040", "ACC-041", "ACC-042", "ACC-043",
];
const accBuckets = [
  accIncomplete.slice(0, 5),
  accIncomplete.slice(5),
];
for (const bucket of accBuckets) {
  for (const id of bucket) {
    if (assignments[id]) throw new Error(`ACC id ${id} double-claimed`);
    assignments[id] = String(next);
  }
  next += 1;
}

console.log("Next free prompt number after module/shared/accounting campaigns:", next);

// Verify every incomplete 1039-matrix feature is claimed exactly once.
const unclaimed = incomplete.filter(r => !claimed.has(r.feature_id));
if (unclaimed.length) {
  console.log(`UNCLAIMED (${unclaimed.length}):`, unclaimed.slice(0, 30).map(r => r.feature_id).join(", "));
  throw new Error(`${unclaimed.length} incomplete features were not assigned to any prompt.`);
}

fs.writeFileSync(
  "scripts/validation/.generated/prompt-assignments.json",
  JSON.stringify(assignments, null, 2),
);
fs.writeFileSync(
  "scripts/validation/.generated/prompt-assignments-summary.json",
  JSON.stringify({ nextFreePrompt: next, totalAssigned: Object.keys(assignments).length }, null, 2),
);
console.log("Wrote prompt-assignments.json —", Object.keys(assignments).length, "feature IDs assigned.");
