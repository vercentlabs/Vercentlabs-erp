import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const errors = [];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function stripAnchor(value) {
  return value.split("#", 1)[0].split("?", 1)[0];
}

function isExternal(value) {
  return /^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(value) || value.startsWith("#");
}

function resolveLocal(sourceFile, value) {
  const cleaned = decodeURIComponent(stripAnchor(value).trim().replace(/^<|>$/g, ""));
  if (!cleaned || isExternal(cleaned)) return null;
  if (cleaned.includes("*") || cleaned.includes("{") || cleaned.includes("}")) return null;
  return cleaned.startsWith("/")
    ? path.join(root, cleaned.slice(1))
    : path.resolve(path.dirname(sourceFile), cleaned);
}

function check(sourceFile, rawTarget, line) {
  const resolved = resolveLocal(sourceFile, rawTarget);
  if (!resolved) return;
  if (!fs.existsSync(resolved)) {
    errors.push(`${path.relative(root, sourceFile)}:${line}: missing local target ${rawTarget}`);
  }
}

const markdownFiles = [path.join(root, "README.md"), ...walk(path.join(root, "docs"))]
  .filter((file, index, all) => all.indexOf(file) === index);

for (const file of markdownFiles) {
  const source = fs.readFileSync(file, "utf8");
  const lines = source.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    // Standard Markdown links/images. Skip external URLs and anchors.
    for (const match of lineText.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      check(file, match[1].split(/\s+["']/)[0], index + 1);
    }
    // README is the repository entry point and historically carried stale
    // backticked docs paths, so validate its explicit local documentation refs.
    if (file === path.join(root, "README.md")) {
      for (const match of lineText.matchAll(/`((?:docs\/|PROJECT_STRUCTURE\.md)[^`]*)`/g)) {
        check(file, match[1], index + 1);
      }
    }
  });
}

if (errors.length) {
  console.error("Documentation link/path verification failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Documentation link/path verification passed (${markdownFiles.length} Markdown files).`);
