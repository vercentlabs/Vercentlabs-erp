import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(
  "apps/web/src/app/(app)/crm/reports/page.tsx",
  "utf8",
);
const route = fs.readFileSync(
  "apps/web/src/app/api/crm/reports/[report]/route.ts",
  "utf8",
);

test("CRM report cards do not expose a raw JSON action", () => {
  assert.doesNotMatch(page, />\s*JSON\s*</);
  assert.match(page, /Download CSV/);
  assert.match(page, /format=csv/);
});

test("empty reports use a useful business-facing state", () => {
  assert.match(page, /No report data yet/);
  assert.match(page, /current company and branch/);
  assert.match(page, /No data to export/);
});

test("report values and headings are human-readable", () => {
  assert.match(page, /function displayValue/);
  assert.match(page, /replace\(\/\(\[a-z0-9\]\)\(\[A-Z\]\)\/g/);
  assert.doesNotMatch(page, /String\(row\[column\] \?\? ""\)/);
});

test("CSV report export is governed and remains same-origin", () => {
  assert.match(route, /rowsToCsv/);
  assert.match(route, /url\.searchParams\.get\("format"\) === "csv"/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /text\/csv; charset=utf-8/);
  assert.match(route, /private, no-store/);
  assert.match(route, /requireCrmReportView\(session, report\)/);
});

test("the programmatic JSON API remains available for integrations", () => {
  assert.match(route, /return ok\(result\)/);
});
