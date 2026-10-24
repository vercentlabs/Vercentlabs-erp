#!/usr/bin/env node
// Copy lint for Sales (Sales report, "Words to change"): the words people read on Sales screens, and the messages the Sales server sends
// back, use everyday words. It parses each file and checks only text a person sees — JSX text, and string literals that read as a phrase
// (they contain a space or start with a capital) — so identifiers, status values and API fields such as "posted" or "reserved" are left
// alone. It also fails help text (a description, hint or helpText) over 20 words.
//
//   node scripts/copy-lint.mjs            check apps/web/src/features/sales and services/api/src/modules/sales
//   node scripts/copy-lint.mjs <paths…>   check those files or folders
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const DEFAULT_ROOTS = ["apps/web/src/features/sales", "apps/web/src/app/(workspace)/sales", "services/api/src/modules/sales"];
const MAX_HELP_WORDS = 20;

// Each banned word, and what to say instead.
const BANNED = [
  { pattern: /\bsupersed(e|ed|es|ing)\b/i, use: "replaced by a newer version" },
  { pattern: /\bfulfil(l)?(ment|led|ling|s)?\b/i, use: "delivery / delivered" },
  { pattern: /\b(un)?reserv(e|ed|es|ing|ation|ations)\b/i, use: "keep stock aside / kept aside" },
  { pattern: /\binvoiceable\b/i, use: "ready to bill" },
  { pattern: /\bpost(ed|ing|s)?\b(?!-dated)/i, use: "finalise / final" },
  { pattern: /\breverse(d|s)?\b(?! charge)/i, use: "cancel (makes a reversing entry)" },
  { pattern: /\b(un)?allocat(e|ed|es|ion|ions)\b/i, use: "paid against / not used yet" },
  { pattern: /\bdisposition\b/i, use: "what to do with the goods" },
  { pattern: /\bconsignee\b/i, use: "ship to" },
  { pattern: /\bage?ing\b/i, use: "how long unpaid" },
  { pattern: /\bcancel remaining\b/i, use: "cancel what is not delivered yet" },
  { pattern: /\bcredit hold\b/i, use: "waiting for credit approval" },
  { pattern: /\boverrid(e|es|den|ing)\b/i, use: "change the price" },
];
const HELP_PROPS = new Set(["description", "hint", "helpText"]);
// Strings that are code, not words people read.
const CODE_ATTRIBUTES = new Set(["className", "href", "key", "id", "queryKey", "type", "name", "role", "target", "rel", "src", "method", "as", "variant", "tone", "size"]);

function filesUnder(entry) {
  const full = path.resolve(repo, entry);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((child) => {
    const next = path.join(full, child.name);
    if (child.isDirectory()) return child.name === "node_modules" ? [] : filesUnder(next);
    return /\.(tsx|ts|js|mjs)$/.test(child.name) && !/\.d\.ts$/.test(child.name) ? [next] : [];
  });
}

const reads = (text) => /\s/.test(text.trim()) || /^[A-Z]/.test(text.trim());
// SQL, addresses and query strings are code even when they hold a space or a capital.
const SQL = /\b(SELECT|FROM|WHERE|JOIN|COALESCE|FILTER|INSERT|UPDATE|DELETE|RETURNING|LATERAL|EXISTS|GREATEST|LEAST|CASE WHEN)\b/;
const looksLikeCode = (text) => SQL.test(text) || /\bIN \(|\$\d|::/.test(text) || /^\s*[(/]/.test(text) || /[?&][a-z]+=/.test(text) || /^\s*(AND|OR|THEN|ELSE|END)\b/.test(text)
  // An HTTP method name ("POST", "GET"…), not words a person reads.
  || /^(GET|POST|PUT|PATCH|DELETE)$/.test(text);

function attributeName(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isJsxAttribute(current)) return current.name.getText();
    if (ts.isPropertyAssignment(current)) return current.name.getText().replace(/["']/g, "");
    if (ts.isCallExpression(current) || ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isVariableDeclaration(current)) return null;
  }
  return null;
}

function isCode(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isLiteralTypeNode(parent) || ts.isExternalModuleReference(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent)) return true;
  if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(parent.operatorToken.kind)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isCallExpression(parent) && /\b(query|require|import|includes|startsWith|endsWith|get|has|set|test|match|replace|split)$/.test(parent.expression.getText())) return true;
  const attribute = attributeName(node);
  return attribute ? CODE_ATTRIBUTES.has(attribute) : false;
}

function check(file) {
  const source = fs.readFileSync(file, "utf8");
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const problems = [];
  const report = (node, message) => {
    const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    problems.push(`${path.relative(repo, file).replaceAll("\\", "/")}:${line + 1}  ${message}`);
  };
  const words = (node, text) => {
    if (!text.trim() || isCode(node)) return;
    if (!ts.isJsxText(node) && (!reads(text) || looksLikeCode(text))) return;
    for (const entry of BANNED) {
      const match = text.match(entry.pattern);
      if (match) report(node, `"${match[0]}" → ${entry.use}   in: ${text.trim().slice(0, 90)}`);
    }
  };
  const help = (node, text) => {
    const attribute = attributeName(node);
    if (!attribute || !HELP_PROPS.has(attribute)) return;
    const count = text.trim().split(/\s+/).filter(Boolean).length;
    if (count > MAX_HELP_WORDS) report(node, `help text has ${count} words (at most ${MAX_HELP_WORDS}): ${text.trim().slice(0, 90)}…`);
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { words(node, node.text); help(node, node.text); }
    else if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" x ");
      words(node, text); help(node, text);
    } else if (ts.isJsxText(node)) words(node, node.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return problems;
}

const roots = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;
const problems = roots.flatMap(filesUnder).flatMap(check);
for (const line of problems) console.log(line);
console.log(problems.length ? `\ncopy-lint: ${problems.length} problem${problems.length === 1 ? "" : "s"}` : "copy-lint: ok");
process.exit(problems.length ? 1 : 0);
