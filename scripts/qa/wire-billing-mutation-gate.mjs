// One-time batch migration tool (SP011 Section 3 completion): adds
// `{ mutation: true }` to every requireCrmAccess/requirePosAccess call
// site that lives inside a POST/PUT/PATCH/DELETE route handler, across a
// caller-supplied file list. Read-only (GET) handlers in the same file are
// left untouched by tracking brace depth per top-level exported handler
// function -- a call site is only rewritten while inside a function whose
// `export async function <METHOD>` header names a mutation method.
//
// Deliberately narrow: it does NOT decide which files to touch (that
// judgment call about business-write vs security/export/admin is made by
// hand, file list supplied on stdin/argv) and it never invents a new call
// site -- it only appends the options object to a call that already
// exists, so a route with no requireCrmAccess/requirePosAccess call at all
// is left exactly as it was (and should be reviewed separately).
import fs from "node:fs";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node wire-billing-mutation-gate.mjs <file1> <file2> ...");
  process.exit(1);
}

const CALL_PATTERN = /(requireCrmAccess|requirePosAccess)\(client,\s*session(?:,\s*([^)]+))?\)/;

let totalChanged = 0;
for (const filePath of files) {
  const original = fs.readFileSync(filePath, "utf8");
  const lines = original.split("\n");
  let currentMethod = null;
  let braceDepth = 0;
  let changed = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const header = line.match(/^export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/);
    if (header) {
      currentMethod = header[1];
      braceDepth = 0;
    }

    if (currentMethod) {
      for (const ch of line) {
        if (ch === "{") braceDepth += 1;
        else if (ch === "}") braceDepth -= 1;
      }
    }

    if (currentMethod && MUTATION_METHODS.has(currentMethod)) {
      const match = line.match(CALL_PATTERN);
      if (match && !line.includes("mutation: true")) {
        const fnName = match[1];
        const permissionArg = match[2];
        const replacement = permissionArg
          ? `${fnName}(client, session, ${permissionArg}, { mutation: true })`
          : `${fnName}(client, session, undefined, { mutation: true })`;
        lines[i] = line.replace(CALL_PATTERN, replacement);
        changed = true;
      }
    }

    if (currentMethod && braceDepth <= 0 && line.trim() === "}") {
      currentMethod = null;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, lines.join("\n"));
    totalChanged += 1;
    console.log(`WIRED  ${filePath}`);
  } else {
    console.log(`SKIP   ${filePath} (no mutation-method requireCrmAccess/requirePosAccess call found)`);
  }
}

console.log(`\n${totalChanged}/${files.length} files changed.`);
