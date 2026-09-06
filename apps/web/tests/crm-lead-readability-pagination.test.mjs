import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Lead Kanban paginates every lifecycle column instead of rendering the full 500-row board", () => {
  const source = read(
    "apps/web/src/modules/crm/components/leads-workspace.tsx",
  );
  assert.match(source, /const KANBAN_PAGE_SIZE = 6/);
  assert.match(source, /kanbanPages/);
  assert.match(source, /visibleRows = stageRows\.slice/);
  assert.match(source, /crm-lead-kanban-pagination/);
  assert.match(source, /Page \{currentPage\} of \{pageCount\}/);
  assert.match(source, /changeKanbanPage\(stage, currentPage - 1\)/);
  assert.match(source, /changeKanbanPage\(stage, currentPage \+ 1\)/);
  assert.match(source, /\{pageCount > 1 \? \(/);
  assert.match(source, /aria-label="Lead lifecycle Kanban board"/);
  assert.match(source, /handleKanbanKeyDown/);
  assert.match(
    source,
    /draggable=\{\s*canManage && !working && !isRefreshingBoard/,
  );
  assert.match(source, /cardDragStart/);
  assert.doesNotMatch(source, /crm-lead-kanban-drag-handle/);
  assert.match(source, /is-single-stage/);
});

test("The server-backed table pagination is not misleadingly shown in Kanban", () => {
  const source = read(
    "apps/web/src/modules/crm/components/leads-workspace.tsx",
  );
  assert.match(source, /view === "table" \? \([\s\S]*crm-leads-pagination/);
  assert.doesNotMatch(source, /Move active leads through qualification/);
  assert.doesNotMatch(source, /Kanban paging summary/);
});

test("The lead suite has an explicit readability layer with human-sized operating text", () => {
  const source = read(
    "apps/web/src/modules/crm/components/leads-workspace.tsx",
  );
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
  assert.match(source, /id: "actions",[\s\S]*width: "240px"/);
  assert.doesNotMatch(source, /className="crm-lead-id">\s*<span>/);
  assert.match(source, /fixedLayout/);
  assert.match(
    css,
    /\.crm-lead-row-buttons\s*\{[\s\S]*?justify-content: flex-start/,
  );
  assert.match(css, /\.crm-lead-kanban-pagination/);
  assert.match(
    css,
    /\.crm-leads-kanban-column\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
  );
  assert.match(
    css,
    /Final Kanban cascade:[\s\S]*?\.crm-leads-kanban-cards\s*\{[\s\S]*?flex:\s*none;/,
  );
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

test("Lead list, create and detail have purpose-built tablet and phone layouts", () => {
  const source = read(
    "apps/web/src/modules/crm/components/leads-workspace.tsx",
  );
  const suite = read("apps/web/src/app/crm-lead-suite-enterprise.css");
  const create = read("apps/web/src/app/crm-lead-create.css");

  assert.match(suite, /Lead workspace responsive system/);
  assert.match(
    suite,
    /@media \(max-width: 900px\)[\s\S]*?\.crm-leads-table-scroll\s*\{\s*display: none;[\s\S]*?\.crm-leads-mobile-list\s*\{[\s\S]*?grid-template-columns: repeat\(2/,
  );
  assert.match(
    suite,
    /@media \(max-width: 680px\)[\s\S]*?\.crm-leads-mobile-list\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(suite, /\.crm-leads-mobile-contact/);
  assert.match(
    suite,
    /\.crm-lead-detail-page \.lead-detail-tabs\s*\{[\s\S]*?position: sticky/,
  );
  assert.match(create, /Lead create responsive system/);
  assert.match(
    create,
    /@media \(max-width: 1100px\)[\s\S]*?\.crm-lead-create-layout\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    create,
    /@media \(max-width: 640px\)[\s\S]*?\.crm-lead-field-grid,[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(source, /htmlFor="crm-lead-search"/);
  assert.match(source, /type="search"/);
  assert.match(source, /caption="Leads matching the current search and filters"/);
  assert.match(source, /mailto:\$\{mobileEmail\}/);
  assert.match(source, /tel:\$\{mobilePhone\}/);
});

test("Lead layouts respond to the usable workspace and preserve mobile task priority", () => {
  const list = read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  const detail = read(
    "apps/web/src/modules/crm/components/lead-detail-workspace.tsx",
  );
  const createSource = read(
    "apps/web/src/modules/crm/components/lead-create-workspace.tsx",
  );
  const drawer = read(
    "apps/web/src/modules/crm/components/lead-workspace-drawer.tsx",
  );
  const suite = read("apps/web/src/app/crm-lead-suite-enterprise.css");
  const create = read("apps/web/src/app/crm-lead-create.css");

  assert.match(suite, /container-name: lead-workspace/);
  assert.match(suite, /@container lead-workspace \(max-width: 1080px\)/);
  assert.match(list, /aria-controls="crm-leads-advanced-filters"/);
  assert.match(list, /crm-leads-filter-grid\$\{filtersExpanded/);
  assert.match(list, /const selectedCount = selectionMode === "filter" \? total : selected\.size;[\s\S]*?if \(!canManage \|\| !selectedCount\) return/);
  assert.match(list, /\{canManage && \(selected\.size \|\| selectionMode === "filter"\) \? \(/);
  assert.match(drawer, /role="dialog"/);
  assert.match(drawer, /aria-modal="true"/);
  assert.match(drawer, /event\.key === "Escape"/);

  assert.match(detail, /role="tablist"/);
  assert.match(detail, /role="tabpanel"/);
  assert.match(detail, /aria-selected=\{tab === item\}/);
  assert.match(detail, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);

  assert.doesNotMatch(createSource, /Capture enough context/);
  assert.match(
    create,
    /\.crm-lead-create-rail > \.crm-lead-rail-card:not\(\.crm-lead-duplicate-card\)/,
  );
  assert.match(
    create,
    /@media \(max-width: 640px\)[\s\S]*?\.crm-lead-create-command__actions\s*\{\s*display: none/,
  );
});

test("Lead create, edit and view stay in one blurred drawer workspace", () => {
  const manager = read(
    "apps/web/src/modules/crm/components/resource-manager.tsx",
  );
  const list = read("apps/web/src/modules/crm/components/leads-workspace.tsx");
  const page = read("apps/web/src/app/(app)/crm/[resource]/page.tsx");
  const suite = read("apps/web/src/app/crm-lead-suite-enterprise.css");

  assert.match(manager, /leadModeUrl\(mode\?: "create" \| "edit" \| "view"/);
  assert.match(manager, /<LeadWorkspaceDrawer[\s\S]*title="Create lead"/);
  assert.match(manager, /<CrmLeadDetailWorkspace[\s\S]*embedded/);
  assert.match(list, /onView\(id\)/);
  assert.doesNotMatch(list, /href=\{`\/crm\/leads\/\$\{id\}`\}/);
  assert.match(page, /view\?: string/);
  assert.match(page, /getLeadDetailData\(client, context, viewId\)/);
  assert.match(
    suite,
    /\.crm-lead-drawer-backdrop[\s\S]*backdrop-filter: blur\(5px\)/,
  );
  assert.match(suite, /\.crm-lead-drawer[\s\S]*right: 0/);
});

test("Lead detail drawer keeps one identity hierarchy and aligned responsive controls", () => {
  const detail = read(
    "apps/web/src/modules/crm/components/lead-detail-workspace.tsx",
  );
  const css = read("apps/web/src/app/crm-hci-redesign.css");

  assert.match(detail, /crm-lead-detail-summary/);
  assert.doesNotMatch(detail, /crm-lead-detail-identity/);
  assert.doesNotMatch(detail, /← Lead queue/);
  assert.match(css, /Lead record drawer: one calm hierarchy/);
  assert.match(
    css,
    /\.crm-lead-drawer \.crm-lead-stage-strip button\s*\{[\s\S]*?min-height:\s*44px/,
  );
  assert.match(css, /grid-template-columns:\s*repeat\(9, max-content\)/);
  assert.match(css, /@container \(max-width:\s*560px\)/);
});

test("Every lead detail tab component is covered by the drawer responsive system", () => {
  const detail = read(
    "apps/web/src/modules/crm/components/lead-detail-workspace.tsx",
  );
  const css = read("apps/web/src/app/crm-hci-redesign.css");
  const componentClasses = [
    "crm-lead-tab-panel",
    "crm-suite-surface",
    "crm-suite-section-heading",
    "crm-suite-two-column",
    "crm-suite-form",
    "crm-suite-check",
    "crm-suite-list",
    "crm-suite-empty",
    "crm-lead-timeline",
    "crm-lead-score-history",
    "crm-file-divider",
    "crm-attachment-list",
    "crm-attachment-form",
    "crm-tag-picker",
    "crm-custom-field-editor",
    "crm-inline-actions",
    "crm-helper-copy",
    "crm-duplicate-compare",
  ];

  for (const className of componentClasses) {
    assert.match(detail, new RegExp(className));
    assert.match(css, new RegExp(`\\.crm-lead-drawer \\.${className}`));
  }
  assert.match(css, /Exhaustive lead-detail component pass/);
});
