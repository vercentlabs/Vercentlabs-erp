// Two `export *` sources of the package index that export DIFFERENT bindings
// under one name make that name ambiguous: Node refuses the named import while
// the web bundler silently picks one of them (a period forecast snapshot route
// once ran the per-opportunity function of the same name this way).
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const indexPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/index.js");

test("the package index exports every name from exactly one binding", async () => {
  const source = fs.readFileSync(indexPath, "utf8");
  const stars = [...source.matchAll(/^export \* from "(.+?)";/gm)].map((match) => match[1]);
  assert.ok(stars.length > 0);
  const owners = new Map();
  for (const specifier of stars) {
    const resolved = specifier.startsWith(".") ? path.resolve(path.dirname(indexPath), specifier) : createRequire(indexPath).resolve(specifier);
    const namespace = await import(pathToFileURL(resolved).href);
    for (const [name, value] of Object.entries(namespace)) {
      const entries = owners.get(name) ?? [];
      if (!entries.some((entry) => entry.value === value)) entries.push({ specifier, value });
      owners.set(name, entries);
    }
  }
  const ambiguous = [...owners].filter(([, entries]) => entries.length > 1).map(([name, entries]) => `${name}: ${entries.map((entry) => entry.specifier).join(" | ")}`);
  assert.deepEqual(ambiguous, []);
});
