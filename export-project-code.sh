#!/usr/bin/env bash

set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
output_arg="${1:-project-code.txt}"

# Keep traversal and file I/O in one Node process. This avoids hundreds of
# process launches in Git Bash and lets Node interpret native Windows paths.
exec node --input-type=module - "$project_root" "$output_arg" <<'NODE'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const projectRoot = path.resolve(process.argv[2]);
const outputArg = process.argv[3];
const outputFile = path.isAbsolute(outputArg)
  ? path.resolve(outputArg)
  : path.resolve(projectRoot, outputArg);
const tempFile = `${outputFile}.tmp`;

const skippedDirectories = new Set([
  ".git",
  "node_modules",
  ".pnpm",
  ".turbo",
  ".cxx",
  "dist",
  "build",
  "coverage",
  ".next",
  ".expo",
  ".cache",
  ".gradle",
  "Pods",
  "target",
  "vendor",
  "__pycache__",
  "tmp",
  "temp",
]);
const sourceExtensions = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".vue", ".svelte", ".astro", ".py", ".pyi", ".rb", ".php", ".java",
  ".kt", ".kts", ".go", ".rs", ".c", ".h", ".cc", ".cpp", ".cs",
  ".fs", ".fsx", ".swift", ".scala", ".sh", ".bash", ".zsh", ".ps1",
  ".sql", ".graphql", ".gql", ".proto", ".html", ".htm", ".css",
  ".scss", ".sass", ".less", ".xml", ".xsl", ".json", ".jsonc",
  ".yaml", ".yml", ".toml", ".ini", ".conf", ".config", ".properties",
  ".gradle", ".md", ".mdx", ".txt", ".prisma", ".tf", ".tfvars",
]);
const exactSourceNames = new Set([
  ".dockerignore",
  ".editorconfig",
  ".env.example",
  ".env.sample",
  ".eslintignore",
  ".gitattributes",
  ".gitignore",
  ".npmrc",
  ".prettierignore",
  "Dockerfile",
  "Containerfile",
  "Makefile",
  "CMakeLists.txt",
  "Jenkinsfile",
  "Procfile",
]);

const normalizeForComparison = (value) => {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};
const excludedOutputs = new Set([
  normalizeForComparison(outputFile),
  normalizeForComparison(tempFile),
]);
const relativeFiles = [];
const sourceExportMarker = Buffer.from("# Project source export");

function isSourceFile(name) {
  return (
    exactSourceNames.has(name) ||
    name.startsWith("Dockerfile.") ||
    sourceExtensions.has(path.extname(name))
  );
}

function isSensitiveFile(name) {
  if (name === ".env.example" || name === ".env.sample") return false;
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    [".pem", ".key", ".p12", ".pfx"].includes(path.extname(name))
  );
}

function addRelativeFile(relativePath) {
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const segments = normalizedPath.split("/");
  const name = segments.at(-1);
  if (
    !name ||
    normalizedPath === "apps/mobile/android" ||
    normalizedPath.startsWith("apps/mobile/android/") ||
    segments.slice(0, -1).some((segment) => skippedDirectories.has(segment)) ||
    isSensitiveFile(name) ||
    !isSourceFile(name)
  ) {
    return;
  }
  const absolutePath = path.join(projectRoot, ...segments);
  if (excludedOutputs.has(normalizeForComparison(absolutePath))) return;
  try {
    if (!lstatSync(absolutePath).isFile()) return;
  } catch {
    return;
  }
  relativeFiles.push(normalizedPath);
}

function collectGitFiles() {
  const result = spawnSync(
    "git",
    [
      "-C",
      projectRoot,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error || result.status !== 0) return false;
  for (const relativePath of result.stdout.split("\0")) {
    if (relativePath) addRelativeFile(relativePath);
  }
  return true;
}

function collectFiles(directory, relativeDirectory = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;
    if (entry.isDirectory()) {
      if (
        skippedDirectories.has(entry.name) ||
        relativePath === "apps/mobile/android"
      ) {
        continue;
      }
      collectFiles(path.join(directory, entry.name), relativePath);
      continue;
    }
    if (entry.isFile()) addRelativeFile(relativePath);
  }
}

mkdirSync(path.dirname(outputFile), { recursive: true });
rmSync(tempFile, { force: true });

let descriptor;
let fileCount = 0;
try {
  if (!collectGitFiles()) collectFiles(projectRoot);
  relativeFiles.sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );

  descriptor = openSync(tempFile, "wx");
  writeSync(
    descriptor,
    `# Project source export\n# Root: ${path.basename(projectRoot)}\n` +
      `# Generated: ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}\n\n`,
  );

  for (const relativePath of relativeFiles) {
    const absolutePath = path.join(projectRoot, ...relativePath.split("/"));
    const contents = readFileSync(absolutePath);
    if (
      contents.length === 0 ||
      contents.includes(0) ||
      contents.subarray(0, sourceExportMarker.length).equals(sourceExportMarker)
    ) {
      continue;
    }
    writeSync(
      descriptor,
      "\n================================================================================\n" +
        `FILE: ${relativePath}\n` +
        "================================================================================\n\n",
    );
    writeSync(descriptor, contents);
    writeSync(descriptor, "\n");
    fileCount += 1;
  }
  closeSync(descriptor);
  descriptor = undefined;
  rmSync(outputFile, { force: true });
  renameSync(tempFile, outputFile);
} catch (error) {
  if (descriptor !== undefined) closeSync(descriptor);
  rmSync(tempFile, { force: true });
  throw error;
}

console.log(`Exported ${fileCount} source files to ${outputFile}`);
NODE
