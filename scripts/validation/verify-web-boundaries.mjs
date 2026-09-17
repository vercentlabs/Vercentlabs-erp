#!/usr/bin/env node
// NOT CURRENTLY WIRED to any root script or CI workflow (removed during the
// clean-slate frontend rebuild's repository-hygiene pass — see
// docs/frontend-rebuild/README.md). This checks layer boundaries
// (shared/core/orchestration/modules) in apps/web/src, which was the OLD
// architecture's layering convention; the new apps/web doesn't have that
// structure yet (nothing built past the bootstrap placeholder), so running
// this now just reports the new directories as "missing," not as violations
// of anything real. Kept as reference for whoever defines the new
// architecture's layering convention (Prompt 2/3) — rewrite the `layers`
// map below against that convention and re-wire a root script once it
// exists, rather than guessing it here.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const layers = {
  shared: path.join(root, "apps/web/src/shared"),
  core: path.join(root, "apps/web/src/core"),
  orchestration: path.join(root, "apps/web/src/orchestration"),
  modules: path.join(root, "apps/web/src/modules"),
};

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const violations = [];

function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];

  const result = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, {
      withFileTypes: true,
    })) {
      const full = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(full);
        continue;
      }

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        result.push(full);
      }
    }
  }

  walk(directory);
  return result;
}

function imports(source) {
  return [
    ...source.matchAll(
      /(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g,
    ),
  ].map((match) => match[1]);
}

function report(file, specifier, reason) {
  violations.push({
    file: path.relative(root, file).replaceAll("\\", "/"),
    specifier,
    reason,
  });
}

for (const file of filesIn(layers.shared)) {
  const source = fs.readFileSync(file, "utf8");

  for (const specifier of imports(source)) {
    if (
      specifier.startsWith("@/core") ||
      specifier.startsWith("@/orchestration") ||
      specifier.startsWith("@/modules")
    ) {
      report(
        file,
        specifier,
        "shared must not depend on core, orchestration or business modules",
      );
    }
  }
}

for (const file of filesIn(layers.core)) {
  const source = fs.readFileSync(file, "utf8");

  for (const specifier of imports(source)) {
    if (
      specifier.startsWith("@/modules") ||
      specifier.startsWith("@/orchestration")
    ) {
      report(
        file,
        specifier,
        "core must remain business-module independent",
      );
    }
  }
}

if (!fs.existsSync(layers.orchestration)) {
  violations.push({
    file: "apps/web/src/orchestration",
    specifier: "",
    reason: "web orchestration layer is required",
  });
}

if (violations.length) {
  console.error("\nWEB ARCHITECTURE BOUNDARY VIOLATIONS\n");

  for (const violation of violations) {
    console.error(
      `- ${violation.file}` +
        (violation.specifier
          ? ` -> ${violation.specifier}`
          : "") +
        `\n  ${violation.reason}`,
    );
  }

  console.error(
    `\n${violations.length} boundary violation(s) detected.`,
  );

  process.exit(1);
}

console.log(
  "Web architecture boundaries verified: " +
  "shared -> core -> orchestration -> modules composition is clean.",
);
