import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  getStructuredFieldConfig,
  parseStructuredValue,
  structuredValueSummary,
} from "../../packages/shared-types/src/structured-fields.js";

const read = (path) => fs.readFileSync(path, "utf8");

const crm = read("apps/web/src/lib/crm.ts");
const validation = read("apps/web/src/lib/crm-validation.ts");
const webManager = read("apps/web/src/components/crm-resource-manager.tsx");
const webEditor = read("apps/web/src/components/structured-field-editor.tsx");
const mobileManager = read("apps/mobile/src/shared/components/resource-manager-screen.tsx");
const mobileEditor = read("apps/mobile/src/shared/components/structured-field-editor.tsx");
const mobileTypes = read("packages/shared-sdk/src/mobile.d.ts");

test("every customer-facing CRM JSON field has guided metadata", () => {
  const matches = [
    ...crm.matchAll(
      /\{\s*name:\s*"([^"]+)"[\s\S]{0,120}?label:\s*"[^"]*JSON[^"]*"[\s\S]{0,80}?type:\s*"textarea"/g,
    ),
  ];
  assert.ok(matches.length >= 35, "expected the enterprise structured-field set");
  for (const match of matches) {
    const config = getStructuredFieldConfig(match[1], "Technical JSON");
    assert.ok(config, `${match[1]} needs guided metadata`);
    assert.doesNotMatch(config.label, /\bJSON\b/i);
  }
});

test("conditions and actions are parsed as structured values", () => {
  assert.equal(getStructuredFieldConfig("conditions")?.kind, "key-value");
  assert.equal(getStructuredFieldConfig("actions")?.kind, "actions");
  assert.deepEqual(parseStructuredValue('{"status":"qualified"}', "key-value"), {
    status: "qualified",
  });
  assert.deepEqual(parseStructuredValue('[{"type":"assign_owner"}]', "actions"), [
    { type: "assign_owner" },
  ]);
  assert.doesNotMatch(validation, /const jsonFields = new Set/);
  assert.match(validation, /getStructuredFieldConfig/);
});

test("CRM definitions strip technical labels before reaching clients", () => {
  assert.match(crm, /applyStructuredFieldMetadata/);
  assert.match(crm, /structuredKind: structured\.kind/);
  assert.match(crm, /label: structured\.label/);
});

test("web CRM forms render structured editors instead of raw textareas", () => {
  assert.match(webManager, /StructuredFieldEditor/);
  assert.match(webManager, /field\.structuredKind/);
  assert.match(webEditor, /data-structured-field/);
  assert.match(webEditor, /Advanced configuration/);
  assert.match(webEditor, /Add labelled value/);
  assert.match(webEditor, /Add action/);
  assert.match(webEditor, /Weekly availability|structured-schedule/);
});

test("mobile CRM forms preserve objects and expose guided configuration", () => {
  assert.match(mobileManager, /JSON\.stringify\(value\)/);
  assert.match(mobileManager, /StructuredFieldEditor/);
  assert.match(mobileEditor, /Guided configuration/);
  assert.match(mobileEditor, /Save configuration/);
  assert.match(mobileEditor, /function scheduleDay/);
  assert.match(mobileEditor, /function updateScheduleDay/);
  assert.doesNotMatch(mobileEditor, /Array</);
  assert.doesNotMatch(mobileEditor, /parts\[parts\.length - 1\]/);
  assert.match(mobileTypes, /structuredKind\?/);
});

test("structured summaries never expose object source text", () => {
  assert.equal(structuredValueSummary({ a: 1, b: 2 }), "2 values configured");
  assert.equal(structuredValueSummary(["a"]), "1 item configured");
  assert.doesNotMatch(structuredValueSummary({ secret: "hidden" }), /secret|hidden/);
});

test("the backend keeps JSON storage while the UI becomes guided", () => {
  const migrations = read("database/tenant/migrations/002_crm_module.sql");
  assert.match(migrations, /criteria jsonb/);
  assert.match(migrations, /conditions jsonb/);
  assert.match(migrations, /actions jsonb/);
  assert.match(validation, /JSON\.parse/);
});
