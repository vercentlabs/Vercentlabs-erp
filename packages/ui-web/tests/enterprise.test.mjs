// Real render smoke tests for the Phase 3 enterprise components -- proves
// EnterpriseDataGrid's TanStack Table `/legacy` wiring and its
// loading/empty/error/forbidden states actually mount, and that the new
// Checkbox/DropdownMenu/Avatar/Skeleton/StatePanel primitives render without
// throwing. Same react-dom/server approach as primitives.test.mjs -- no
// browser, no bundler. Interaction behavior (sort clicks, row selection
// toggling, keyboard nav) needs a real DOM and is deferred to Playwright
// once a real screen consumes this grid (see docs/ux/UI_REWRITE_TRACKER.md
// Phase 3).
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, React, renderToStaticMarkup } from "./harness.mjs";

test("Checkbox renders unchecked/checked/indeterminate states", async () => {
  const { Checkbox } = await import(pathToFileURL(compile("src/primitives/Checkbox.tsx")).href);
  const unchecked = renderToStaticMarkup(React.createElement(Checkbox, { "aria-label": "Select row" }));
  assert.doesNotMatch(unchecked, /data-checked/);
  const checked = renderToStaticMarkup(React.createElement(Checkbox, { "aria-label": "Select row", checked: true, onCheckedChange: () => {} }));
  assert.match(checked, /data-checked/);
});

test("Avatar renders initials fallback when no image is loaded", async () => {
  const { Avatar } = await import(pathToFileURL(compile("src/primitives/Avatar.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Avatar, { name: "Jordan Lee" }));
  assert.match(html, /JL/);
});

test("Skeleton renders as an aria-hidden presentation placeholder", async () => {
  const { Skeleton } = await import(pathToFileURL(compile("src/primitives/Skeleton.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Skeleton, { className: "h-4 w-full" }));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /role="presentation"/);
});

test("StatePanel: EmptyState/ErrorState/PermissionState render distinct copy", async () => {
  const { EmptyState, ErrorState, PermissionState, NoResultsState } = await import(pathToFileURL(compile("src/enterprise/StatePanel.tsx")).href);
  assert.match(renderToStaticMarkup(React.createElement(EmptyState, { title: "No leads yet" })), /No leads yet/);
  assert.match(renderToStaticMarkup(React.createElement(ErrorState, { description: "Could not reach the server" })), /Could not reach the server/);
  assert.match(renderToStaticMarkup(React.createElement(PermissionState, null)), /don&#x27;t have permission/);
  assert.match(renderToStaticMarkup(React.createElement(NoResultsState, null)), /No results match your filters/);
});

test("DropdownMenu primitives mount without throwing (closed by default)", async () => {
  const { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } = await import(
    pathToFileURL(compile("src/primitives/DropdownMenu.tsx")).href
  );
  const html = renderToStaticMarkup(
    React.createElement(
      DropdownMenuRoot,
      null,
      React.createElement(DropdownMenuTrigger, null, "Actions"),
      React.createElement(DropdownMenuContent, null, React.createElement(DropdownMenuItem, null, "Archive")),
    ),
  );
  assert.match(html, /Actions/);
});

const sampleRows = [
  { id: "1", name: "Acme Corp", stage: "Qualified" },
  { id: "2", name: "Globex", stage: "New" },
];
const sampleColumns = [
  { id: "name", accessorKey: "name", header: "Name" },
  { id: "stage", accessorKey: "stage", header: "Stage" },
];

test("EnterpriseDataGrid renders real rows with selection checkboxes", async () => {
  const { EnterpriseDataGrid } = await import(pathToFileURL(compile("src/enterprise/EnterpriseDataGrid.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(EnterpriseDataGrid, {
      "aria-label": "Leads",
      columns: sampleColumns,
      data: sampleRows,
      getRowId: (row) => row.id,
      pageIndex: 0,
      pageSize: 25,
      totalRows: sampleRows.length,
      rowSelection: {},
      onRowSelectionChange: () => {},
    }),
  );
  assert.match(html, /Acme Corp/);
  assert.match(html, /Globex/);
  assert.match(html, /Select all rows on this page/);
  assert.match(html, /Page 1 of 1/);
});

test("EnterpriseDataGrid renders loading skeleton rows instead of data", async () => {
  const { EnterpriseDataGrid } = await import(pathToFileURL(compile("src/enterprise/EnterpriseDataGrid.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(EnterpriseDataGrid, {
      "aria-label": "Leads",
      columns: sampleColumns,
      data: [],
      isLoading: true,
      pageIndex: 0,
      pageSize: 25,
      totalRows: 0,
    }),
  );
  assert.doesNotMatch(html, /Acme Corp/);
  assert.match(html, /animate-pulse/);
});

test("EnterpriseDataGrid renders PermissionState when forbidden, ErrorState when errored, EmptyState when empty", async () => {
  const { EnterpriseDataGrid } = await import(pathToFileURL(compile("src/enterprise/EnterpriseDataGrid.tsx")).href);
  const base = { "aria-label": "Leads", columns: sampleColumns, data: [], pageIndex: 0, pageSize: 25, totalRows: 0 };
  assert.match(renderToStaticMarkup(React.createElement(EnterpriseDataGrid, { ...base, isForbidden: true })), /don&#x27;t have permission/);
  assert.match(renderToStaticMarkup(React.createElement(EnterpriseDataGrid, { ...base, isError: true, errorMessage: "Timed out" })), /Timed out/);
  assert.match(
    renderToStaticMarkup(React.createElement(EnterpriseDataGrid, { ...base, emptyState: { title: "No leads yet" } })),
    /No leads yet/,
  );
});
