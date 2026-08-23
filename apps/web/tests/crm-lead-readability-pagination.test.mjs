import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Lead Kanban paginates every lifecycle column instead of rendering the full 500-row board", () => {
  const source = read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  assert.match(source, /const KANBAN_PAGE_SIZE = 10/);
  assert.match(source, /kanbanPages/);
  assert.match(source, /visibleRows = stageRows\.slice/);
  assert.match(source, /crm-lead-kanban-pagination/);
  assert.match(source, /Page \{currentPage\} of \{pageCount\}/);
  assert.match(source, /changeKanbanPage\(stage, currentPage - 1\)/);
  assert.match(source, /changeKanbanPage\(stage, currentPage \+ 1\)/);
});

test("The server-backed table pagination is not misleadingly shown in Kanban", () => {
  const source = read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  assert.match(source, /view === "table" \? \([\s\S]*crm-leads-pagination/);
  assert.match(source, /Each lifecycle column shows/);
  assert.match(source, /\{KANBAN_PAGE_SIZE\} cards at a time/);
});

test("The lead suite has an explicit readability layer with human-sized operating text", () => {
  const source = read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  const css = read("apps/web/src/app/crm-lead-suite-enterprise.css");
  assert.match(css, /VERCENTLABS CRM READABILITY PASS START/);
  assert.match(css, /\.crm-suite-page,[\s\S]*font-size: 14px/);
  assert.match(css, /\.crm-suite-command p:last-child,[\s\S]*font-size: 15px/);
  assert.match(css, /\.crm-suite-form input,[\s\S]*min-height: 44px/);
  assert.match(css, /\.crm-suite-table th,[\s\S]*font-size: 13px/);
  assert.match(css, /\.crm-leads-enterprise-main\s*\{[\s\S]*?gap: 20px/);
  assert.match(css, /\.crm-suite-search input\s*\{[\s\S]*?min-height: 54px/);
  assert.match(
    css,
    /\.crm-leads-filter-grid select\s*\{[\s\S]*?min-height: 54px/,
  );
  assert.match(
    css,
    /\.crm-leads-filter-grid select\s*\{[\s\S]*?appearance: none;[\s\S]*?padding: 11px 44px 11px 18px/,
  );
  assert.match(
    css,
    /\.crm-leads-bulk-bar select\s*\{[\s\S]*?appearance: none;[\s\S]*?min-height: 54px/,
  );
  assert.match(
    css,
    /\.crm-leads-bulk-bar > button\s*\{[\s\S]*?min-height: 54px/,
  );
  assert.match(
    css,
    /\.crm-leads-status-tabs button\s*\{[\s\S]*?min-height: 44px/,
  );
  assert.match(source, /<colgroup>[\s\S]*crm-leads-col-actions/);
  assert.doesNotMatch(source, /className="crm-lead-id">\s*<span>/);
  assert.match(
    css,
    /\.crm-leads-table-scroll table\s*\{[\s\S]*?table-layout: fixed/,
  );
  assert.match(
    css,
    /\.crm-lead-row-buttons\s*\{[\s\S]*?justify-content: flex-start/,
  );
  assert.match(css, /\.crm-lead-kanban-pagination/);
  assert.match(
    css,
    /\.crm-leads-kanban-column\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
  );
  assert.match(css, /\.crm-leads-kanban-cards\s*\{[\s\S]*?flex:\s*1 1 auto;/);
});

test("Lead Create and CRM Overview receive the same readability treatment", () => {
  const create = read("apps/web/src/app/crm-lead-create.css");
  const overview = read("apps/web/src/app/crm-overview-redesign.css");
  assert.match(create, /VERCENTLABS CRM READABILITY PASS START/);
  assert.match(create, /\.crm-lead-field-grid input,[\s\S]*min-height: 46px/);
  assert.match(create, /font-size: 14px/);
  assert.match(overview, /VERCENTLABS CRM READABILITY PASS START/);
  assert.match(
    overview,
    /\.crm-overview-command__identity p:last-child[\s\S]*font-size: 15px/,
  );
  assert.match(
    overview,
    /\.crm-overview-attention strong\s*\{\s*font-size: 18px/,
  );
  assert.match(
    overview,
    /\.crm-overview-attention span:not\(\.crm-overview-attention__signal\),[\s\S]*?font-size: 13px/,
  );
});
