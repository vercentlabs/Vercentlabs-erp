import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(process.cwd(), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("shared pagination exposes ranges, page numbers and directional controls", () => {
  const controls = read("apps/web/src/components/pagination-controls.tsx");
  const links = read("apps/web/src/components/pagination-links.tsx");

  for (const source of [controls, links]) {
    assert.match(source, /Showing/);
    assert.match(source, /Previous/);
    assert.match(source, /Next/);
    assert.match(source, /aria-current/);
    assert.match(source, /totalItems <= pageSize/);
    assert.match(source, /ellipsis-start/);
    assert.match(source, /totalPages <= 7/);
  }
});

test("generic record managers paginate filtered rows", () => {
  for (const file of [
    "apps/web/src/components/business-data-manager.tsx",
    "apps/web/src/components/resource-manager.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /PaginationControls/);
    assert.match(source, /PAGE_SIZE/);
    assert.match(source, /\.slice\(/);
  }
});

test("CRM resources paginate and filter at the database boundary", () => {
  const page = read("apps/web/src/app/(app)/crm/[resource]/page.tsx");
  const manager = read("apps/web/src/components/crm-resource-manager.tsx");
  const service = read("services/api/src/crm.js");

  assert.match(page, /limit: PAGE_SIZE/);
  assert.match(page, /offset: \(page - 1\) \* PAGE_SIZE/);
  assert.match(page, /search,/);
  assert.match(page, /status,/);
  assert.match(manager, /totalItems=\{total\}/);
  assert.doesNotMatch(manager, /filtered\.slice/);
  assert.match(service, /SELECT count\(\*\)::int AS total/);
  assert.match(service, /LIMIT \$\{addParameter\(parameters, limit\)\}/);
  assert.match(service, /OFFSET \$\{addParameter\(parameters, offset\)\}/);
});

test("CRM export continues in batches beyond the old 500-row ceiling", () => {
  const route = read("apps/web/src/app/api/crm/[resource]/export/route.ts");
  assert.match(route, /EXPORT_BATCH_SIZE = 500/);
  assert.match(route, /offset: rows\.length/);
  assert.match(route, /while \(rows\.length < total\)/);
});

test("Sales order and quotation filters preserve URL pagination", () => {
  for (const file of [
    "apps/web/src/app/(app)/sales/orders/page.tsx",
    "apps/web/src/app/(app)/sales/quotations/page.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /PaginationLinks/);
    assert.match(source, /filters\.page/);
    assert.match(source, /visibleRows/);
  }
});

test("pagination remains usable on narrow screens", () => {
  const css = read("apps/web/src/app/globals.css");
  assert.match(css, /\.pagination-bar/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.pagination-pages/);
});
