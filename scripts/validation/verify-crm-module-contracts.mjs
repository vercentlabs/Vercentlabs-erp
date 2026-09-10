import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const crmRoot = path.join(root, "services/api/src/modules/crm");
const failures = [];

function walk(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
  }
  return files;
}

function resolveRelative(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = path.extname(base)
    ? [base]
    : [`${base}.js`, path.join(base, "index.js")];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const exportCache = new Map();
const exportStack = new Set();
function exportedNames(file) {
  if (exportCache.has(file)) return exportCache.get(file);
  if (exportStack.has(file)) return new Set();
  exportStack.add(file);
  const source = fs.readFileSync(file, "utf8");
  const names = new Set();

  for (const match of source.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(/export\s*\{([\s\S]*?)\}\s*(?:from\s*["']([^"']+)["'])?\s*;?/g)) {
    for (const raw of match[1].split(",")) {
      const item = raw.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!item) continue;
      const parts = item.split(/\s+as\s+/);
      const publicName = (parts[1] || parts[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(publicName)) names.add(publicName);
    }
  }

  for (const match of source.matchAll(/export\s*\*\s*from\s*["']([^"']+)["']\s*;?/g)) {
    const target = resolveRelative(file, match[1]);
    if (!target) {
      failures.push(`${path.relative(root, file)} re-exports unresolved module ${match[1]}`);
      continue;
    }
    for (const name of exportedNames(target)) names.add(name);
  }

  exportStack.delete(file);
  exportCache.set(file, names);
  return names;
}

for (const file of walk(crmRoot)) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']\s*;?/g)) {
    const specifier = match[2];
    if (!specifier.startsWith(".")) continue;
    const target = resolveRelative(file, specifier);
    if (!target) {
      failures.push(`${path.relative(root, file)} imports unresolved module ${specifier}`);
      continue;
    }
    const available = exportedNames(target);
    for (const raw of match[1].split(",")) {
      const item = raw.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!item) continue;
      const importedName = item.split(/\s+as\s+/)[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(importedName) && !available.has(importedName)) {
        failures.push(`${path.relative(root, file)} imports ${importedName} from ${path.relative(root, target)}, but that module does not export it`);
      }
    }
  }
}

if (failures.length) {
  console.error("CRM module contract validation failed:");
  for (const failure of failures) console.error(`  ERROR: ${failure}`);
  process.exit(1);
}

console.log(`CRM module contracts verified across ${walk(crmRoot).length} JavaScript module(s).`);
