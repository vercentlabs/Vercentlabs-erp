import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { ANALYTICS_EVENTS } from "../src/index.js";

/**
 * Structural guard against the analytics-event drift bug found independently
 * in Phase 3 and Phase 4: index.d.ts's ANALYTICS_EVENTS literal-union type
 * and navigation.js's runtime ANALYTICS_EVENTS array must declare the exact
 * same set of event names. Both times, the type drifted ahead of the runtime
 * array with no test catching it — this test reads index.d.ts's own source
 * text (no TS compiler dependency needed; the tuple is a flat quoted-string
 * list) and diffs it against the real runtime array, so drift is a hard
 * failure instead of a hoped-for manual sync.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DECLARATION_PATH = path.join(__dirname, "../src/index.d.ts");

function extractDeclaredEventNames() {
  const source = readFileSync(DECLARATION_PATH, "utf8");
  const match = source.match(/export const ANALYTICS_EVENTS: readonly \[([\s\S]*?)\];/);
  assert.ok(match, "index.d.ts must declare `export const ANALYTICS_EVENTS: readonly [...]`");
  const body = match[1];
  // Match both quote styles so a single-quoted literal (valid TypeScript,
  // invisible to a double-quote-only regex) can never silently slip past
  // this guard uncounted — the exact failure mode this test exists to catch.
  const names = [...body.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(names.length > 0, "Could not parse any event names out of index.d.ts's ANALYTICS_EVENTS tuple");
  // Beyond parsing them correctly, flag single-quoted entries outright: every
  // other string literal in this file uses double quotes, so a lone
  // single-quoted entry is itself a style inconsistency worth surfacing, not
  // just silently tolerating.
  const singleQuoted = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(
    singleQuoted,
    [],
    `index.d.ts's ANALYTICS_EVENTS tuple has single-quoted entr${singleQuoted.length === 1 ? "y" : "ies"} (${singleQuoted.join(", ")}) — use double quotes to match the rest of the file`,
  );
  return names;
}

test("index.d.ts's ANALYTICS_EVENTS type and navigation.js's runtime array declare the exact same event set", () => {
  const declared = extractDeclaredEventNames();
  const runtime = [...ANALYTICS_EVENTS];

  const declaredSet = new Set(declared);
  const runtimeSet = new Set(runtime);

  const declaredOnly = declared.filter((name) => !runtimeSet.has(name));
  const runtimeOnly = runtime.filter((name) => !declaredSet.has(name));

  assert.deepEqual(
    declaredOnly,
    [],
    `index.d.ts declares event name(s) with no runtime backing in navigation.js: ${declaredOnly.join(", ")}`,
  );
  assert.deepEqual(
    runtimeOnly,
    [],
    `navigation.js's runtime array has event name(s) not declared in index.d.ts's type: ${runtimeOnly.join(", ")}`,
  );
});

test("no duplicate event names within index.d.ts's declared tuple", () => {
  const declared = extractDeclaredEventNames();
  assert.equal(new Set(declared).size, declared.length, "index.d.ts's ANALYTICS_EVENTS tuple has a duplicate entry");
});

test("no duplicate event names within navigation.js's runtime array", () => {
  const runtime = [...ANALYTICS_EVENTS];
  assert.equal(new Set(runtime).size, runtime.length, "navigation.js's ANALYTICS_EVENTS array has a duplicate entry");
});
