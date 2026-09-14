// Real render smoke tests for the Phase 3 layout/record/form enterprise
// components added for the CRM Leads golden reference (List page and Lead
// 360). Same react-dom/server approach as the other test files.
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, React, renderToStaticMarkup } from "./harness.mjs";

test("PageShell/PageHeader/SectionHeader render title, description and actions", async () => {
  const { PageShell } = await import(pathToFileURL(compile("src/enterprise/PageShell.tsx")).href);
  const { PageHeader, SectionHeader } = await import(pathToFileURL(compile("src/enterprise/PageHeader.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      PageShell,
      null,
      React.createElement(PageHeader, { title: "Leads", description: "All open leads", actions: React.createElement("button", null, "New lead") }),
      React.createElement(SectionHeader, { title: "Activity" }),
    ),
  );
  assert.match(html, /Leads/);
  assert.match(html, /All open leads/);
  assert.match(html, /New lead/);
  assert.match(html, /Activity/);
});

test("RecordHeader renders identity, status and metrics together", async () => {
  const { RecordHeader } = await import(pathToFileURL(compile("src/enterprise/RecordHeader.tsx")).href);
  const { MetricCard } = await import(pathToFileURL(compile("src/enterprise/MetricCard.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(RecordHeader, {
      title: "Acme Corp",
      subtitle: "Enterprise plan",
      status: React.createElement("span", null, "Qualified"),
      metrics: React.createElement(MetricCard, { label: "Score", value: "82" }),
      primaryAction: React.createElement("button", null, "Convert"),
    }),
  );
  assert.match(html, /Acme Corp/);
  assert.match(html, /Qualified/);
  assert.match(html, /Score/);
  assert.match(html, /82/);
  assert.match(html, /Convert/);
});

test("ActionBar/FilterBar/BulkActionBar render their content and hide when empty", async () => {
  const { ActionBar } = await import(pathToFileURL(compile("src/enterprise/ActionBar.tsx")).href);
  const { FilterBar } = await import(pathToFileURL(compile("src/enterprise/FilterBar.tsx")).href);
  const { BulkActionBar } = await import(pathToFileURL(compile("src/enterprise/BulkActionBar.tsx")).href);

  assert.match(renderToStaticMarkup(React.createElement(ActionBar, null, "Export")), /Export/);
  assert.match(
    renderToStaticMarkup(React.createElement(FilterBar, { search: React.createElement("input") }, React.createElement("span", null, "Stage: New"))),
    /Stage: New/,
  );
  assert.strictEqual(renderToStaticMarkup(React.createElement(BulkActionBar, { count: 0, actions: "Archive" })), "");
  assert.match(renderToStaticMarkup(React.createElement(BulkActionBar, { count: 3, actions: "Archive" })), /3 selected/);
});

test("ActivityTimeline and AuditTimeline render items or an empty-state message", async () => {
  const { ActivityTimeline, AuditTimeline } = await import(pathToFileURL(compile("src/enterprise/ActivityTimeline.tsx")).href);
  assert.match(renderToStaticMarkup(React.createElement(ActivityTimeline, { items: [] })), /No activity yet/);
  assert.match(
    renderToStaticMarkup(
      React.createElement(ActivityTimeline, {
        items: [{ id: "1", title: "Called lead", timestamp: "2h ago", description: "Left voicemail" }],
      }),
    ),
    /Called lead/,
  );
  assert.match(
    renderToStaticMarkup(
      React.createElement(AuditTimeline, {
        entries: [{ id: "1", field: "Stage", from: "New", to: "Qualified", changedBy: "Jordan Lee", timestamp: "1d ago" }],
      }),
    ),
    /Qualified/,
  );
});

test("FormField wires label/description/error ids together and FormActions renders", async () => {
  const { FormField, FormActions, FormSection } = await import(pathToFileURL(compile("src/enterprise/FormField.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      FormSection,
      { title: "Contact" },
      React.createElement(FormField, { label: "Email", required: true, error: "Required" }, (fieldProps) =>
        React.createElement("input", fieldProps),
      ),
    ),
  );
  assert.match(html, /Email/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /role="alert"/);
  assert.match(renderToStaticMarkup(React.createElement(FormActions, null, "Save")), /Save/);
});
