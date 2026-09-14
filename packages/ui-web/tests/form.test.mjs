// Real render smoke tests for the TanStack Form + Zod field system
// (packages/ui-web/src/form/*). Proves useAppForm's field bindings mount
// with real zod validators wired in and render label/value/required-marker
// output correctly. Deeper interaction (typing triggers validation, submit
// button enables once dirty+valid) needs a real DOM with event dispatch and
// is deferred to Playwright once a real screen uses this system (see
// docs/ux/UI_REWRITE_TRACKER.md Phase 3).
import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { compile, React, renderToStaticMarkup } from "./harness.mjs";

test("useAppForm renders TextField/SelectField/TextareaField with zod validation wired in", async () => {
  const { useAppForm } = await import(pathToFileURL(compile("src/form/useAppForm.ts")).href);
  const { z } = await import("zod");

  const schema = z.object({
    name: z.string().min(1, "Name is required"),
    stage: z.string(),
    notes: z.string().optional(),
  });

  function LeadForm() {
    const form = useAppForm({
      defaultValues: { name: "", stage: "new", notes: "" },
      validators: { onChange: schema },
      onSubmit: () => {},
    });
    return React.createElement(
      "form",
      null,
      React.createElement(form.AppField, { name: "name" }, (field) => React.createElement(field.TextField, { label: "Name", required: true })),
      React.createElement(form.AppField, { name: "stage" }, (field) =>
        React.createElement(field.SelectField, {
          label: "Stage",
          options: [
            { value: "new", label: "New" },
            { value: "qualified", label: "Qualified" },
          ],
        }),
      ),
      React.createElement(form.AppField, { name: "notes" }, (field) => React.createElement(field.TextareaField, { label: "Notes" })),
      React.createElement(form.AppForm, null, React.createElement(form.FormSubmitButton, null, "Save lead")),
    );
  }

  const html = renderToStaticMarkup(React.createElement(LeadForm));
  assert.match(html, /Name/);
  assert.match(html, /Stage/);
  assert.match(html, /Notes/);
  assert.match(html, /Save lead/);
  // Required marker rendered for the Name field, not for Stage/Notes.
  assert.match(html, /<span[^>]*aria-hidden="true"[^>]*>\*<\/span>/);
  // Pristine, untouched form: the submit button starts disabled (not dirty yet).
  assert.match(html, /Save lead[\s\S]*?<\/button>/);
  const buttonMatch = html.match(/<button[^>]*>Save lead<\/button>/) ?? html.match(/<button[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(buttonMatch, "expected a submit button in the rendered form");
  assert.match(buttonMatch[0], /disabled=""/);
});

test("EntityLookupField and MultiSelectField mount without throwing", async () => {
  const { useAppForm } = await import(pathToFileURL(compile("src/form/useAppForm.ts")).href);

  function AssignmentForm() {
    const form = useAppForm({
      defaultValues: { ownerId: null, tags: [] },
      onSubmit: () => {},
    });
    return React.createElement(
      "form",
      null,
      React.createElement(form.AppField, { name: "ownerId" }, (field) =>
        React.createElement(field.EntityLookupField, { label: "Owner", onSearch: async () => [{ value: "u1", label: "Jordan Lee" }] }),
      ),
      React.createElement(form.AppField, { name: "tags" }, (field) =>
        React.createElement(field.MultiSelectField, {
          label: "Tags",
          items: [
            { value: "hot", label: "Hot" },
            { value: "enterprise", label: "Enterprise" },
          ],
        }),
      ),
    );
  }

  const html = renderToStaticMarkup(React.createElement(AssignmentForm));
  assert.match(html, /Owner/);
  assert.match(html, /Tags/);
});
