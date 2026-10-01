// CRM public API compatibility lock.
//
// Structural CRM refactors (renaming or moving files under
// services/api/src/modules/crm/) must not add, drop or rename a single exported
// name. This test pins the exact set of CRM export names reachable through
//   - the CRM module boundary (services/api/src/modules/crm/index.js), and
//   - the package index `@vercentlabs/api` (services/api/src/index.js), which
//     today also re-exports many CRM capability files directly.
//
// A package export counts as "CRM" when some file under modules/crm/ exports
// the same name bound to the identical value. That rule does not depend on
// directory or file names, so it survives renames and moves.
//
// The list is deliberately broad (it includes names nothing uses yet). When a
// later pass intentionally narrows or changes the public CRM API, regenerate
// the snapshot on purpose and review the diff:
//   UPDATE_CRM_API_EXPORTS=1 node --test services/api/tests/crm-public-api-exports.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../src");
const crmRoot = path.join(srcRoot, "modules/crm");
const snapshotPath = path.join(here, "snapshots/crm-public-api-exports.json");

function crmSourceFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) return crmSourceFiles(absolute);
      return entry.isFile() && entry.name.endsWith(".js") ? [absolute] : [];
    });
}

async function currentCrmExports() {
  const crmBindings = new Map(); // name -> Set of values exported under that name by a CRM file
  for (const file of crmSourceFiles(crmRoot)) {
    const namespace = await import(pathToFileURL(file).href);
    for (const [name, value] of Object.entries(namespace)) {
      if (!crmBindings.has(name)) crmBindings.set(name, new Set());
      crmBindings.get(name).add(value);
    }
  }
  const isCrm = ([name, value]) => crmBindings.get(name)?.has(value) ?? false;
  const packageIndex = await import(pathToFileURL(path.join(srcRoot, "index.js")).href);
  const moduleIndex = await import(pathToFileURL(path.join(crmRoot, "index.js")).href);
  return {
    crmModuleIndex: Object.keys(moduleIndex).sort(),
    packageIndex: Object.entries(packageIndex).filter(isCrm).map(([name]) => name).sort(),
  };
}

test("CRM export names are unchanged by structural refactors", async () => {
  const actual = await currentCrmExports();
  if (process.env.UPDATE_CRM_API_EXPORTS === "1") {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, `${JSON.stringify(actual, null, 2)}\n`);
  }
  const expected = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  for (const boundary of ["crmModuleIndex", "packageIndex"]) {
    const want = new Set(expected[boundary]);
    const have = new Set(actual[boundary]);
    const missing = [...want].filter((name) => !have.has(name));
    const added = [...have].filter((name) => !want.has(name));
    assert.deepEqual({ boundary, missing, added }, { boundary, missing: [], added: [] });
  }
});
