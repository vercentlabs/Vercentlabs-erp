import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import * as landingContent from "../src/index.js";

// Structural guardrails for the package layout described in README.md.
const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const read = (relative) => readFileSync(path.join(srcDir, relative), "utf8");

function sourceFiles(dir = srcDir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

const WORKSPACE_DEPENDENCIES = new Set(["@vercentlabs/shared-types", "@vercentlabs/config"]);
const MODULE_SUPPORT_FILES = new Set(["index.js", "capability-group.js", "platform-governance.js", "modules-page.js"]);

test("each catalog module has exactly one content file named by its catalog key", async () => {
  const moduleFiles = readdirSync(path.join(srcDir, "modules"))
    .filter((name) => name.endsWith(".js") && !MODULE_SUPPORT_FILES.has(name))
    .map((name) => name.replace(/\.js$/, ""))
    .sort();
  assert.deepEqual(moduleFiles, ERP_MODULE_CATALOG.map((erpModule) => erpModule.key).sort());
  for (const key of moduleFiles) {
    const exported = Object.values(await import(`../src/modules/${key}.js`));
    assert.equal(exported.length, 1, `modules/${key}.js exports one module definition`);
    assert.equal(exported[0].key, key, `modules/${key}.js declares key "${key}"`);
  }
});

test("the module collection follows ERP catalog order", () => {
  assert.deepEqual(
    landingContent.LANDING_MODULES.map((landingModule) => landingModule.key),
    ERP_MODULE_CATALOG.map((erpModule) => erpModule.key),
  );
});

test("the package root re-exports every content family", () => {
  const root = read("index.js");
  const statements = root.split("\n").filter((line) => line.trim() && !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"));
  for (const line of statements) assert.match(line, /^export \* from "\.\/[\w/-]+\.js";$/, `index.js only re-exports families: ${line}`);
  for (const family of ["capabilities/index.js", "modules/index.js", "platform/index.js", "workflows.js", "homepage.js", "navigation.js", "metadata.js"]) {
    assert.ok(root.includes(`"./${family}"`), `index.js re-exports ./${family}`);
  }
  for (const name of ["LANDING_MODULES", "LAUNCH_CAPABILITY_TOTAL", "PLATFORM_PAGES", "PRODUCT_OVERVIEW_PAGE", "SECURITY_PAGE", "MODULES_INDEX_PAGE", "CTAS", "HERO"]) {
    assert.ok(name in landingContent, `root exports ${name}`);
  }
});

test("landing-content stays framework-free", () => {
  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");
    const imports = [...source.matchAll(/^\s*(?:import|export)[^"']*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
    for (const specifier of imports) {
      assert.ok(
        specifier.startsWith(".") || WORKSPACE_DEPENDENCIES.has(specifier),
        `${path.relative(srcDir, file)} imports "${specifier}" — only relative files and framework-free workspace packages are allowed`,
      );
    }
    assert.doesNotMatch(source, /<[A-Z][A-Za-z]*[\s/>]/, `${path.relative(srcDir, file)} contains JSX`);
  }
});
