import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as landingContent from "@vercentlabs/landing-content";

// @vercentlabs/landing-content is plain JS with a hand-maintained declaration
// file. This test keeps the two in step: every runtime export must be declared
// and every declared value must exist at runtime. Type-only declarations
// (interface / type) have no runtime counterpart and are ignored.
const require = createRequire(import.meta.url);
const ts = require("typescript");

const declarationPath = fileURLToPath(new URL("../../../packages/landing-content/src/index.d.ts", import.meta.url));

function declaredValueExports() {
  const source = ts.createSourceFile(declarationPath, readFileSync(declarationPath, "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set();
  for (const statement of source.statements) {
    const exported = ts.getModifiers?.(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(statement)) {
      assert.fail("index.d.ts must declare exports inline; `export { … }` / `export *` hide drift from this test");
    }
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) names.add(declaration.name.getText(source));
    } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      names.add(statement.name.text);
    }
  }
  return names;
}

test("every runtime export of @vercentlabs/landing-content is declared in index.d.ts", () => {
  const declared = declaredValueExports();
  const undeclared = Object.keys(landingContent).filter((name) => !declared.has(name));
  assert.deepEqual(undeclared, [], `runtime exports missing from index.d.ts: ${undeclared.join(", ")}`);
});

test("every value declared in index.d.ts exists at runtime", () => {
  const runtime = new Set(Object.keys(landingContent));
  const phantom = [...declaredValueExports()].filter((name) => !runtime.has(name));
  assert.deepEqual(phantom, [], `index.d.ts declares values the package does not export: ${phantom.join(", ")}`);
});

test("declared functions are functions at runtime and declared consts are not", () => {
  const source = readFileSync(declarationPath, "utf8");
  for (const [, name] of source.matchAll(/^export (?:declare )?function (\w+)/gm)) {
    assert.equal(typeof landingContent[name], "function", `${name} is declared as a function`);
  }
  for (const [, name] of source.matchAll(/^export (?:declare )?const (\w+)/gm)) {
    assert.notEqual(typeof landingContent[name], "function", `${name} is declared as a const but exported as a function`);
  }
});
