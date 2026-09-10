#!/usr/bin/env node
// Self-validation for scripts/export/export-source.mjs's output. Generates
// a fresh export, reconstructs it from the archive+manifest into a temp
// directory, and proves the archive is complete, unmodified, and
// internally consistent — the "0 missing / 0 mismatches" contract the
// Prompts 1-5 integrity closeout requires before any export can be trusted
// as an audit artifact.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

const SOURCE_EXTENSIONS_EXPECTED_IN_EXPORT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".json",
]);
const IMPORT_SCAN_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);
const RESOLVE_CANDIDATE_SUFFIXES = [
  "", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json",
  "/index.ts", "/index.tsx", "/index.js", "/index.mjs",
];

function runExport() {
  const output = execFileSync("node", [path.join(scriptDir, "export-source.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const match = output.match(/manifest:\s*(exports[\/\\][^\r\n]+\.manifest\.json)/);
  if (!match) throw new Error(`Could not locate manifest path in export output:\n${output}`);
  return path.join(repoRoot, match[1].trim());
}

function reconstructToTempDir(manifest, archiveBuffer) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vercentlabs-export-verify-"));
  const checksumMismatches = [];
  for (const file of manifest.files) {
    const slice = archiveBuffer.subarray(file.offset, file.offset + file.size);
    const actualSha256 = createHash("sha256").update(slice).digest("hex");
    if (actualSha256 !== file.sha256) {
      checksumMismatches.push({ path: file.path, expected: file.sha256, actual: actualSha256 });
    }
    const destPath = path.join(tempDir, file.path);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, slice);
  }
  return { tempDir, checksumMismatches };
}

function verifyManifestPathCompleteness(manifest, tempDir) {
  const missingManifestFiles = [];
  for (const file of manifest.files) {
    if (!fs.existsSync(path.join(tempDir, file.path))) missingManifestFiles.push(file.path);
  }
  return missingManifestFiles;
}

// Mirrors export-source.mjs's own EXCLUDED_DIR_SEGMENTS: a relative import
// that resolves into one of these directories points at something the
// exporter deliberately never includes (generated build output, most
// commonly) — that is a correct exclusion, not a missing dependency.
const DELIBERATELY_EXCLUDED_SEGMENTS = new Set([
  "node_modules", ".next", "out", "dist", "build", "coverage", ".turbo",
  "test-results", "playwright-report", "exports",
]);

function resolveRelativeImport(fromFile, specifier, includedPathSet) {
  const fromDir = path.posix.dirname(fromFile);
  const raw = path.posix.normalize(path.posix.join(fromDir, specifier));
  if (raw.split("/").some((segment) => DELIBERATELY_EXCLUDED_SEGMENTS.has(segment))) {
    return raw; // resolves into a deliberately-excluded directory — not a gap
  }
  for (const suffix of RESOLVE_CANDIDATE_SUFFIXES) {
    const candidate = suffix ? `${raw}${suffix}` : raw;
    if (includedPathSet.has(candidate)) return candidate;
  }
  return null;
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g,
];

function findMissingLocalImports(manifest, tempDir) {
  const includedPathSet = new Set(manifest.files.map((file) => file.path));
  const missing = [];
  for (const file of manifest.files) {
    const ext = path.extname(file.path).toLowerCase();
    if (!IMPORT_SCAN_EXTENSIONS.has(ext)) continue;
    const content = fs.readFileSync(path.join(tempDir, file.path), "utf8");
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(content))) {
        const specifier = match[1];
        if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue; // package import, not local
        const resolved = resolveRelativeImport(file.path, specifier, includedPathSet);
        if (!resolved) {
          // Only flag as missing if it plausibly resolves to a source file
          // this exporter is expected to include (not a deliberately
          // excluded binary asset such as a CSS/image import).
          const specifierExt = path.extname(specifier).toLowerCase();
          if (specifierExt && !SOURCE_EXTENSIONS_EXPECTED_IN_EXPORT.has(specifierExt)) continue;
          missing.push({ file: file.path, specifier });
        }
      }
    }
  }
  return missing;
}

function anyIncluded(manifest, predicate) {
  return manifest.files.some((file) => predicate(file.path));
}

function newestTenantMigrationOnDisk() {
  const dir = path.join(repoRoot, "database", "tenant", "migrations");
  const files = fs.readdirSync(dir).filter((name) => /^\d+_.*\.sql$/.test(name));
  files.sort();
  return `database/tenant/migrations/${files[files.length - 1]}`;
}

function main() {
  const manifestPath = runExport();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const archivePath = path.join(path.dirname(manifestPath), manifest.archiveFile);
  const archiveBuffer = fs.readFileSync(archivePath);

  const archiveSha256 = createHash("sha256").update(archiveBuffer).digest("hex");
  const archiveIntact = archiveSha256 === manifest.archiveSha256;

  const { tempDir, checksumMismatches } = reconstructToTempDir(manifest, archiveBuffer);
  const missingManifestFiles = verifyManifestPathCompleteness(manifest, tempDir);
  const missingLocalImports = findMissingLocalImports(manifest, tempDir);

  const newestMigration = newestTenantMigrationOnDisk();

  const anchors = {
    "api CRM capability directories present": anyIncluded(manifest, (p) =>
      /^services\/api\/src\/modules\/crm\/[^/]+\//.test(p)),
    "web CRM capability directories present": anyIncluded(manifest, (p) =>
      /^apps\/web\/src\/modules\/crm\/[^/]+\//.test(p)),
    "CRM vNext register present": anyIncluded(manifest, (p) =>
      p === "docs/03-modules/crm/CRM_VNEXT_IMPLEMENTATION_REGISTER.md"),
    [`newest tenant migration present (${newestMigration})`]: anyIncluded(manifest, (p) =>
      p === newestMigration),
    "Prompt 3 (duplicate matching / relationships) present": anyIncluded(manifest, (p) =>
      p.includes("prospect-and-relationship-master-data/duplicate-matching") ||
      p.includes("prospect-and-relationship-master-data/record-version")),
    "Prompt 4/5 CRM worker handlers present": anyIncluded(manifest, (p) =>
      p === "services/worker/src/handlers/crm-lead-stage-migration.js" ||
      p === "services/worker/src/handlers/crm-opportunity-stage-migration.js" ||
      p === "services/worker/src/handlers/crm-lead-score-recalc.js"),
    "Prompt 5 Opportunity governance capability present": anyIncluded(manifest, (p) =>
      p.startsWith("services/api/src/modules/crm/opportunity-and-pipeline-governance/")),
    "CRM E2E spec files present": anyIncluded(manifest, (p) =>
      p.startsWith("apps/web/tests/e2e/erp-crm-")),
  };

  fs.rmSync(tempDir, { recursive: true, force: true });

  console.log("Source export self-validation");
  console.log("==============================");
  console.log(`manifest: ${path.relative(repoRoot, manifestPath)}`);
  console.log(`export id: ${manifest.exportId}  commit: ${manifest.commitSha}  dirty: ${manifest.dirty}`);
  console.log(`files in manifest: ${manifest.fileCount}`);
  console.log(`archive checksum intact: ${archiveIntact}`);
  console.log(`missing manifest files: ${missingManifestFiles.length}`);
  console.log(`checksum mismatches: ${checksumMismatches.length}`);
  console.log(`missing local source dependencies: ${missingLocalImports.length}`);
  console.log("");
  console.log("Anchor checks:");
  let anchorFailures = 0;
  for (const [label, ok] of Object.entries(anchors)) {
    console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}`);
    if (!ok) anchorFailures += 1;
  }

  if (missingManifestFiles.length) {
    console.log("\nMissing manifest files:");
    for (const p of missingManifestFiles.slice(0, 20)) console.log(`  - ${p}`);
  }
  if (checksumMismatches.length) {
    console.log("\nChecksum mismatches:");
    for (const m of checksumMismatches.slice(0, 20)) console.log(`  - ${m.path}`);
  }
  if (missingLocalImports.length) {
    console.log("\nMissing local source dependencies:");
    for (const m of missingLocalImports.slice(0, 20)) console.log(`  - ${m.file} -> ${m.specifier}`);
  }

  const failed =
    !archiveIntact ||
    missingManifestFiles.length > 0 ||
    checksumMismatches.length > 0 ||
    missingLocalImports.length > 0 ||
    anchorFailures > 0;

  console.log("");
  console.log(failed ? "SOURCE EXPORT VALIDATION FAILED" : "SOURCE EXPORT VALIDATION PASSED");
  process.exitCode = failed ? 1 : 0;
}

main();
