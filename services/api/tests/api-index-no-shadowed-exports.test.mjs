import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// The package root re-exports many modules. An explicit `export { name } from` silently wins over an
// `export * from` that also provides `name`, so a caller importing the name gets the wrong module's function.
// This happened for listShifts (HR shadowed Manufacturing) and listInspections (Quality shadowed Manufacturing).
const here = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(here, "../src/index.js");
const source = readFileSync(indexPath, "utf8");

async function load(specifier) {
  return import(pathToFileURL(resolve(dirname(indexPath), specifier)).href);
}

test("no explicit root export hides a different function of the same name from a star export", async () => {
  const starModules = [...source.matchAll(/export \* from "(\.[^"]+)"/g)].map((m) => m[1]);
  const named = [...source.matchAll(/export \{([^}]+)\} from "(\.[^"]+)"/g)].map((m) => ({
    module: m[2],
    names: m[1].split(",").map((n) => n.trim()).filter(Boolean),
  }));

  const starBindings = new Map();
  for (const specifier of starModules) {
    const ns = await load(specifier);
    for (const name of Object.keys(ns)) {
      if (!starBindings.has(name)) starBindings.set(name, []);
      starBindings.get(name).push({ specifier, value: ns[name] });
    }
  }

  const hidden = [];
  for (const { module, names } of named) {
    const ns = await load(module);
    for (const raw of names) {
      const [original, alias] = raw.split(/\s+as\s+/);
      const exported = alias ?? original;
      for (const other of starBindings.get(exported) ?? []) {
        if (other.value !== ns[original]) hidden.push(`${exported}: ${module} hides ${other.specifier}`);
      }
    }
  }
  assert.deepEqual(hidden, []);
});

test("manufacturing shift and inspection lists are exported under their own names", async () => {
  const api = await import(pathToFileURL(indexPath).href);
  assert.equal(typeof api.listManufacturingShifts, "function");
  assert.equal(typeof api.listManufacturingInspections, "function");
  assert.notEqual(api.listManufacturingShifts, api.listShifts);
  assert.notEqual(api.listManufacturingInspections, api.listInspections);
});
