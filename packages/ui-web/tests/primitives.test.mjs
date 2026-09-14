// Real render smoke test for the first ui-web primitives -- proves the
// package's JSX actually mounts (Base UI's Dialog portal/focus-trap wiring
// included), not just that it type-checks. Uses react-dom/server so this
// runs under plain `node --test`, no browser required; deeper interaction
// behavior (focus trap, Escape handling) is covered by Playwright once a
// real screen consumes these components (see docs/ux/UI_REWRITE_TRACKER.md
// Phase 2).
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(import.meta.dirname, "..");
// Scoped to the package's own package.json (not this helper's directory)
// so bare specifiers (react, clsx, @base-ui-components/react/dialog, ...)
// resolve the real installed dependency -- the compiled output lands in an
// os.tmpdir() directory with no node_modules chain of its own, so a bare
// specifier left untouched fails with ERR_MODULE_NOT_FOUND.
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

// Compile in dependency order (leaves first) so no compile() call ever
// re-enters itself while a replace() callback for the same file is still
// running -- resolved paths are looked up from the `compiled` map instead.
function compile(relSourcePath) {
  const sourcePath = path.join(root, relSourcePath);
  if (compiled.has(sourcePath)) return compiled.get(sourcePath);
  const outFile = path.join(tempDir, path.basename(sourcePath).replace(/\.tsx?$/, ".mjs"));
  compiled.set(sourcePath, outFile); // reserve before recursing (breaks cycles)

  const transpiled = transpileOnly(sourcePath)
    // class-variance-authority ships CJS-only; Node's ESM named-export
    // detection for its bundled dist file is unreliable, so import its
    // default and destructure rather than a named import.
    .replace(/import\s*\{\s*cva\s*\}\s*from\s*"class-variance-authority"/, 'import __cva_pkg from "class-variance-authority"; const { cva } = __cva_pkg');
  const rewritten = transpiled.replace(/from\s+"([^"]+)"/g, (whole, specifier) => {
    if (specifier === "../utils/cn" || specifier === "./cn") {
      return `from ${JSON.stringify(pathToFileURL(compile("src/utils/cn.ts")).href)}`;
    }
    if (specifier.startsWith(".")) return whole; // no other relative imports among these files today
    return `from ${JSON.stringify(pathToFileURL(pkgRequire.resolve(specifier)).href)}`;
  });
  fs.writeFileSync(outFile, rewritten);
  return outFile;
}

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

test("Button renders with variant/size classes and forwards a ref", async () => {
  const { Button } = await import(pathToFileURL(compile("src/primitives/Button.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Button, { variant: "danger", size: "large" }, "Delete"));
  assert.match(html, /Delete/);
  assert.match(html, /<button/);
});

test("StatusBadge renders the requested tone", async () => {
  const { StatusBadge } = await import(pathToFileURL(compile("src/primitives/StatusBadge.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(StatusBadge, { tone: "danger" }, "Blocked"));
  assert.match(html, /Blocked/);
});

test("Input marks aria-invalid when invalid", async () => {
  const { Input } = await import(pathToFileURL(compile("src/primitives/Input.tsx")).href);
  const html = renderToStaticMarkup(React.createElement(Input, { invalid: true, placeholder: "Email" }));
  assert.match(html, /aria-invalid="true"/);
});

test("Dialog primitives mount without throwing (closed by default)", async () => {
  const { DialogRoot, DialogTrigger, DialogContent, DialogTitle } = await import(pathToFileURL(compile("src/primitives/Dialog.tsx")).href);
  const html = renderToStaticMarkup(
    React.createElement(
      DialogRoot,
      null,
      React.createElement(DialogTrigger, null, "Open"),
      React.createElement(DialogContent, null, React.createElement(DialogTitle, null, "Confirm")),
    ),
  );
  assert.match(html, /Open/);
});
