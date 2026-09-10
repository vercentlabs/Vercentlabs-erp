import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(
  new URL("../src/modules/crm/crm-data-operations-and-customization/resource-validation.js", import.meta.url),
  "utf8",
);

// Integrity closeout (Prompts 1-5): the millisecond-precision comparison
// logic this file tests was generalized out of assertLeadExpectedVersion
// into assertRecordExpectedVersion (reused for Opportunity ordinary edits
// too) — assertLeadExpectedVersion is now a thin wrapper that delegates to
// it with entityLabel="Lead"/codePrefix="CRM_LEAD". Extract the block that
// actually contains the comparison logic.
function leadVersionBlock() {
  const start = source.indexOf("function assertRecordExpectedVersion");
  const end = source.indexOf("function assertLeadExpectedVersion", start);
  assert.ok(start >= 0 && end > start, "Record version guard should remain present");
  return source.slice(start, end);
}

test("F001 finalization: PostgreSQL Date versions retain millisecond precision", () => {
  const block = leadVersionBlock();
  assert.match(block, /new Date\(record\.updatedAt \?\? ""\)/);
  assert.doesNotMatch(block, /String\(record\.updatedAt/);

  const postgresDate = new Date("2026-09-04T07:05:38.575Z");
  assert.equal(new Date(postgresDate).getTime(), postgresDate.getTime());
  assert.notEqual(
    new Date(String(postgresDate)).getTime(),
    postgresDate.getTime(),
    "String(Date) drops PostgreSQL timestamp milliseconds and can create false stale-write conflicts",
  );
});

test("F001 finalization: Lead optimistic concurrency still rejects unequal versions", () => {
  const current = new Date("2026-09-04T07:05:38.575Z");
  const stale = new Date("2026-09-04T07:05:38.574Z");
  assert.notEqual(current.getTime(), stale.getTime());
  assert.match(leadVersionBlock(), /expected\.getTime\(\) !== actual\.getTime\(\)/);
  assert.match(leadVersionBlock(), /CRM_STALE_WRITE/);
});
