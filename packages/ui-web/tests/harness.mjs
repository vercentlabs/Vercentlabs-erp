// Shared TS->ESM compile-and-render harness for ui-web's `node --test` suite
// (no bundler, no browser). See primitives.test.mjs for the original,
// narrower version of this; generalized here so enterprise.test.mjs can pull
// in components with relative imports that cross subdirectories
// (enterprise/EnterpriseDataGrid.tsx -> ../primitives/*, ./StatePanel).
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const ts = require("typescript");
export const root = path.resolve(import.meta.dirname, "..");
// Scoped to the package's own package.json (not this file's directory) so
// bare specifiers (react, clsx, @base-ui-components/react/dialog, ...) and
// package subpath exports (@tanstack/react-table/legacy) resolve the real
// installed dependency -- compiled output lands in an os.tmpdir() directory
// with no node_modules chain of its own.
const pkgRequire = createRequire(path.join(root, "package.json"));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-web-test-"));
const compiled = new Map();

function transpileOnly(sourcePath) {
  const source = fs.readFileSync(sourcePath, "utf8");
  return ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

function resolveRelative(sourceDir, specifier) {
  const candidates = [specifier, `${specifier}.ts`, `${specifier}.tsx`, `${specifier}/index.ts`, `${specifier}/index.tsx`];
  for (const candidate of candidates) {
    const resolved = path.join(sourceDir, candidate);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  throw new Error(`Cannot resolve relative import "${specifier}" from ${sourceDir}`);
}

// Compiles in dependency order (leaves first) so no compile() call ever
// re-enters itself while a replace() callback for the same file is still
// running -- resolved paths are looked up from the `compiled` map instead
// (reserve-before-recurse breaks cycles).
export function compile(relSourcePath) {
  const sourcePath = path.isAbsolute(relSourcePath) ? relSourcePath : path.join(root, relSourcePath);
  if (compiled.has(sourcePath)) return compiled.get(sourcePath);
  const outFile = path.join(tempDir, `${compiled.size}-${path.basename(sourcePath).replace(/\.tsx?$/, ".mjs")}`);
  compiled.set(sourcePath, outFile);

  const sourceDir = path.dirname(sourcePath);
  const transpiled = transpileOnly(sourcePath)
    // class-variance-authority ships CJS-only; Node's ESM named-export
    // detection for its bundled dist file is unreliable, so import its
    // default and destructure rather than a named import.
    .replace(/import\s*\{\s*cva\s*\}\s*from\s*"class-variance-authority"/, 'import __cva_pkg from "class-variance-authority"; const { cva } = __cva_pkg');
  const rewritten = transpiled.replace(/from\s+"([^"]+)"/g, (whole, specifier) => {
    if (specifier.startsWith(".")) {
      return `from ${JSON.stringify(pathToFileURL(compile(resolveRelative(sourceDir, specifier))).href)}`;
    }
    return `from ${JSON.stringify(pathToFileURL(pkgRequire.resolve(specifier)).href)}`;
  });
  fs.writeFileSync(outFile, rewritten);
  return outFile;
}

export const React = require("react");
export const { renderToStaticMarkup } = require("react-dom/server");
