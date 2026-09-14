// Real render smoke tests for the canonical archetypes built on top of the
// Phase 3 enterprise components: RecordFormSurface (Create/Edit surface)
// and RecordActivityPanel (Audit/Activity surface). Same react-dom/server
// approach as the other test files.
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, React, renderToStaticMarkup } from "./harness.mjs";

test("RecordFormSurface renders title, server error, fields, cancel and the primary action", async () => {
  const { RecordFormSurface } = await import(pathToFileURL(compile("src/archetypes/RecordFormSurface.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      RecordFormSurface,
      {
        title: "New lead",
        description: "Capture a new enquiry",
        serverError: "That lead already exists.",
        onSubmit: () => {},
        onCancel: () => {},
        actions: React.createElement("button", { type: "submit" }, "Save lead"),
      },
      React.createElement("input", { name: "firstName", placeholder: "First name" }),
    ),
  );
  assert.match(html, /New lead/);
  assert.match(html, /That lead already exists\./);
  assert.match(html, /role="alert"/);
  assert.match(html, /Cancel/);
  assert.match(html, /Save lead/);
  assert.match(html, /<form/);
});

test("RecordFormSurface omits the Cancel button when onCancel is not supplied", async () => {
  const { RecordFormSurface } = await import(pathToFileURL(compile("src/archetypes/RecordFormSurface.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      RecordFormSurface,
      { title: "Edit lead", onSubmit: () => {}, actions: React.createElement("button", { type: "submit" }, "Save") },
      "fields",
    ),
  );
  assert.doesNotMatch(html, />Cancel</);
});

test("RecordActivityPanel renders both an activity feed and an audit trail", async () => {
  const { RecordActivityPanel } = await import(pathToFileURL(compile("src/archetypes/RecordActivityPanel.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(RecordActivityPanel, {
      activityItems: [{ id: "1", title: "Logged a call", timestamp: "2h ago" }],
      auditEntries: [{ id: "1", field: "Stage", from: "New", to: "Qualified", changedBy: "Jordan Lee", timestamp: "1d ago" }],
    }),
  );
  assert.match(html, /Activity/);
  assert.match(html, /Logged a call/);
  assert.match(html, /History/);
  assert.match(html, /Qualified/);
});
