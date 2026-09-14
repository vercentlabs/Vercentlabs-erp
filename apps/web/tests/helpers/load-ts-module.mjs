// Shared recursive TS-to-ESM loader for tests. Only ever point this at
// files with no @/core/auth, @/core/db, or next/* runtime dependency — it
// does not sandbox anything, it just makes `@/...` path aliases resolvable
// outside Next.js's own bundler so genuinely pure modules (scoring,
// pure search/registry logic) can be executed for real behavioral
// coverage instead of only source-pattern-matched. See
// docs/implementation/ERP_COMMAND_SURFACE_007.md and the precedent set in
// apps/web/tests/module-access.test.mjs / navigation-registry.test.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const root = path.resolve(import.meta.dirname, "../../../..");
const webSrc = path.join(root, "apps/web/src");
// Scoped to apps/web (not this helper's own directory) so plain npm
// package specifiers (e.g. "zod") resolve the same hoisted pnpm install
// the real module would see -- the compiled output lands in an os.tmpdir()
// directory with no node_modules chain of its own, so a bare specifier
// left untouched (like @/ and @vercentlabs/* already were) would otherwise
// fail with ERR_MODULE_NOT_FOUND for every module that imports anything
// beyond its own source tree.
const webRequire = createRequire(path.join(root, "apps/web/package.json"));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-ts-loader-"));
const compiled = new Map(); // absolute .ts source path -> compiled .mjs file path

function resolveAliasToSourcePath(specifier) {
  if (specifier.startsWith("@/")) {
    return path.join(webSrc, specifier.slice(2));
  }
  // Workspace packages (@vercentlabs/X) resolve straight to their real,
  // already-plain-JS entry file — no @/ alias involved, no transpilation
  // needed for the package itself, but the specifier is still unresolvable
  // by plain Node module resolution from a temp directory outside the
  // monorepo's node_modules symlink tree, so it's rewritten the same way.
  const packageMatch = /^@vercentlabs\/([a-z0-9-]+)$/.exec(specifier);
  if (packageMatch) {
    return { plainJsEntry: path.join(root, "packages", packageMatch[1], "src", "index.js") };
  }
  return null;
}

function findSourceFile(basePathWithoutExtension) {
  for (const extension of [".ts", ".tsx"]) {
    const candidate = basePathWithoutExtension + extension;
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`load-ts-module: could not find a .ts/.tsx file for ${basePathWithoutExtension}`);
}

function compileRecursive(sourcePath) {
  const existing = compiled.get(sourcePath);
  if (existing) return existing;

  const source = fs.readFileSync(sourcePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;

  const outFile = path.join(tempDir, `${path.basename(sourcePath, path.extname(sourcePath))}-${compiled.size}.mjs`);
  // Reserve the slot before recursing so a circular import can't loop forever.
  compiled.set(sourcePath, outFile);

  const rewritten = transpiled.replace(/from\s+"([^"]+)"/g, (whole, specifier) => {
    const resolved = resolveAliasToSourcePath(specifier);
    if (resolved) {
      if (typeof resolved === "object" && resolved.plainJsEntry) {
        return `from "${pathToFileURL(resolved.plainJsEntry).href}"`;
      }
      const resolvedSourceFile = findSourceFile(resolved);
      const compiledDependencyFile = compileRecursive(resolvedSourceFile);
      return `from "${pathToFileURL(compiledDependencyFile).href}"`;
    }
    if (specifier.startsWith(".") || specifier.startsWith("node:")) return whole;
    // A plain npm package specifier (e.g. "zod") -- resolve it against
    // apps/web's own dependency tree rather than leaving it bare, since the
    // compiled file has no node_modules chain of its own from tmpdir().
    return `from "${pathToFileURL(webRequire.resolve(specifier)).href}"`;
  });

  fs.writeFileSync(outFile, rewritten);
  return outFile;
}

export async function loadTsModule(relativePathFromRepoRoot) {
  const sourcePath = path.join(root, relativePathFromRepoRoot);
  const outFile = compileRecursive(sourcePath);
  return import(`${pathToFileURL(outFile).href}?v=${Date.now()}`);
}
