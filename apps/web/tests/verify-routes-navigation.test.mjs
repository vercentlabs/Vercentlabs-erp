// CRM vNext Prompt 2 — regression coverage for the verify:routes
// navigation-registry check (Part of docs/03-modules/crm/
// CRM_VNEXT_IMPLEMENTATION_REGISTER.md CRM-VNEXT-028/CRM-VNEXT-010).
//
// Before this fix, apps/web/scripts/verify-routes.mjs pointed at a
// directory ("../src/lib/navigation") that verify-architecture.mjs's own
// forbidden-path list says must not exist — so the check always examined
// zero files and printed "Checked 0 navigation registry href(s)" while
// still exiting 0. This actually runs the real script as a subprocess
// (not a mock) against the real repository and asserts it both discovers
// the real navigation registry AND would fail loudly rather than silently
// passing if that discovery ever regresses to zero again.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../scripts/verify-routes.mjs", import.meta.url));
const source = fs.readFileSync(scriptPath, "utf8");

test("verify:routes: points at the real, live navigation registry directory (apps/web/src/core/navigation), not the retired apps/web/src/lib/navigation", () => {
  assert.match(source, /const navigationDir = path\.resolve\(path\.dirname\(fileURLToPath\(import\.meta\.url\)\), "\.\.\/src\/core\/navigation"\);/);
});

test("verify:routes: fails loudly (does not silently pass) if the navigation directory is missing or discovers zero hrefs", () => {
  assert.match(source, /if \(!fs\.existsSync\(navigationDir\)\) \{/);
  assert.match(source, /navigation registry directory not found/);
  assert.match(source, /navigationHrefsChecked === 0\) \{/);
  assert.match(source, /zero href\(s\) were discovered/);
});

test("verify:routes: asserts specific, real CRM navigation destinations were actually discovered (not just a non-zero count from an unrelated module)", () => {
  assert.match(source, /"\/crm",\s*"\/crm\/leads",\s*"\/crm\/accounts",\s*"\/crm\/contacts",\s*"\/crm\/opportunities",\s*"\/crm\/activities"/);
  assert.match(source, /expected live CRM navigation entries were not discovered/);
});

test("verify:routes: running the real script against the real repository discovers a substantial, non-zero navigation registry and passes", () => {
  const output = execFileSync("node", [scriptPath], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  const match = output.match(/Checked (\d+) navigation registry href\(s\)/);
  assert.ok(match, "must report a navigation href count");
  const checked = Number(match[1]);
  assert.ok(
    checked > 50,
    `expected the real navigation registry to contain well over 50 hrefs (12 modules' worth); got ${checked} — this would have been 0 under the pre-fix bug`,
  );
  assert.match(output, /Route smoke validation passed/);
});
