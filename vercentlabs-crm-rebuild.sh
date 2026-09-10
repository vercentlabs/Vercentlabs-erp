#!/usr/bin/env bash
set -Eeuo pipefail

# Vercentlabs CRM one-command hardening/refactor pass.
# Grounded against the 2026-09-10 repository snapshot.
# It intentionally automates only deterministic changes; semantic feature rewrites
# remain represented as explicit rebuild gates instead of unsafe blind codemods.

SCRIPT_NAME="$(basename "$0")"
STAMP="$(date +%Y%m%d-%H%M%S)"
SUCCESS=0
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [[ -z "$ROOT" ]]; then
  echo "ERROR: Run this script from inside the Vercentlabs git repository."
  exit 2
fi
cd "$ROOT"

if [[ ! -f package.json || ! -d apps/web/src/modules/crm || ! -d services/api/src/modules/crm ]]; then
  echo "ERROR: This does not look like the audited Vercentlabs repository root."
  exit 2
fi

WORK_DIR="$ROOT/.crm-rebuild"
REPORT_DIR="$WORK_DIR/reports"
mkdir -p "$REPORT_DIR"
LOG_FILE="$REPORT_DIR/run-$STAMP.log"
REPORT_FILE="$REPORT_DIR/run-$STAMP.md"
exec > >(tee -a "$LOG_FILE") 2>&1

ORIGINAL_HEAD="$(git rev-parse HEAD)"
ORIGINAL_BRANCH="$(git branch --show-current || true)"
BACKUP_TAG="crm-rebuild-backup-$STAMP"
WORK_BRANCH="crm-rebuild/$STAMP"
STASH_CREATED=""

rollback() {
  local code=$?
  if [[ "$SUCCESS" -eq 1 ]]; then
    return
  fi
  echo
  echo "A critical step failed. Restoring the CRM rebuild branch to $ORIGINAL_HEAD ..."
  git reset --hard "$ORIGINAL_HEAD" >/dev/null 2>&1 || true
  git clean -fd -- . ':!.crm-rebuild' ":!$SCRIPT_NAME" >/dev/null 2>&1 || true
  echo "Rollback complete. Backup tag: $BACKUP_TAG"
  if [[ -n "$STASH_CREATED" ]]; then
    echo "Your pre-existing work remains safe in git stash: $STASH_CREATED"
  fi
  echo "Log: $LOG_FILE"
  exit "$code"
}
trap rollback ERR INT TERM

section() {
  echo
  echo "================================================================"
  echo "$1"
  echo "================================================================"
}

section "1/8 Preflight and rollback point"

echo "Repo: $ROOT"
echo "HEAD: $ORIGINAL_HEAD"
echo "Branch: ${ORIGINAL_BRANCH:-detached}"

git tag "$BACKUP_TAG" "$ORIGINAL_HEAD"
echo "Created local backup tag: $BACKUP_TAG"

# If the checkout has work in progress, preserve it automatically. The downloaded
# script itself is excluded when it is an untracked file at repository root.
if [[ -n "$(git status --porcelain --untracked-files=all)" ]]; then
  echo "Existing worktree changes detected; preserving them in git stash before the CRM pass."
  BEFORE_STASH="$(git rev-parse -q --verify refs/stash 2>/dev/null || true)"
  if [[ -f "$ROOT/$SCRIPT_NAME" ]] && ! git ls-files --error-unmatch "$SCRIPT_NAME" >/dev/null 2>&1; then
    git stash push -u -m "pre-crm-rebuild-$STAMP" -- . ":(exclude)$SCRIPT_NAME" >/dev/null
  else
    git stash push -u -m "pre-crm-rebuild-$STAMP" >/dev/null
  fi
  AFTER_STASH="$(git rev-parse -q --verify refs/stash 2>/dev/null || true)"
  if [[ -n "$AFTER_STASH" && "$AFTER_STASH" != "$BEFORE_STASH" ]]; then
    STASH_CREATED="$AFTER_STASH"
    echo "Saved pre-existing work in stash $STASH_CREATED"
  fi
fi

# Work on an isolated local branch. No remote operations are performed.
git switch -c "$WORK_BRANCH" >/dev/null
echo "Working branch: $WORK_BRANCH"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
echo "Node: $(node -v 2>/dev/null || echo missing)"
if [[ "$NODE_MAJOR" != "24" ]]; then
  echo "WARN: repository requires Node 24.x. Source-level checks will still run; dependency-heavy verification will be skipped unless Node 24 is active."
fi

section "2/8 Apply deterministic CRM security and entitlement fixes"

node <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.replace(/\r\n/g, '\n'), 'utf8');
}
function replaceOnce(text, before, after, label) {
  if (text.includes(after)) return text;
  const count = text.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one source match, found ${count}`);
  }
  return text.replace(before, after);
}

// ---- Public meeting booking: replace process-local Map with the existing
// distributed DB-backed limiter and bound the JSON body before parsing.
{
  const file = 'apps/web/src/app/api/crm/public/meetings/[token]/bookings/route.ts';
  let text = read(file);
  text = replaceOnce(
    text,
    'import { clientIp } from "@/core/security";',
    'import { clientIp, enforceRateLimit, readRequestBytes } from "@/core/security";',
    `${file} security import`,
  );
  text = text.replace(/\nconst attempts = new Map<string, \{ count: number; resetAt: number \}>\(\);\n/, '\n');
  if (!text.includes('async function readJsonObject(')) {
    const marker = 'import { clientIp, enforceRateLimit, readRequestBytes } from "@/core/security";\n';
    text = replaceOnce(text, marker, `${marker}\nasync function readJsonObject(request: Request, maximumBytes: number) {\n  const bytes = await readRequestBytes(request, maximumBytes);\n  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);\n  let parsed: unknown;\n  try {\n    parsed = JSON.parse(raw);\n  } catch {\n    throw new HttpError(400, "Invalid JSON request.");\n  }\n  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {\n    throw new HttpError(400, "Invalid JSON request.");\n  }\n  return parsed as Record<string, unknown>;\n}\n`, `${file} JSON helper`);
  }
  const oldLimiter = `    const fingerprint = \`\${token}:\${clientIp(request)}\`;\n    const current = attempts.get(fingerprint);\n    if (current && current.resetAt > Date.now() && current.count >= 20) {\n      throw new HttpError(429, "Too many booking attempts. Try again later.");\n    }\n    attempts.set(fingerprint, {\n      count: current && current.resetAt > Date.now() ? current.count + 1 : 1,\n      resetAt:\n        current && current.resetAt > Date.now()\n          ? current.resetAt\n          : Date.now() + 3600000,\n    });`;
  const newLimiter = `    // Distributed limiter: survives process/container/serverless boundaries.\n    // The IP-only guard prevents random-token attacks from creating an unbounded\n    // rate-limit key per guessed token before the token is resolved.\n    await enforceRateLimit(\`crm:public-meeting:ip:\${clientIp(request)}\`, 120, 3600);`;
  if (text.includes(oldLimiter)) text = text.replace(oldLimiter, newLimiter);
  if (!text.includes('crm:public-meeting:ip:')) throw new Error(`${file}: distributed limiter was not installed`);
  text = replaceOnce(
    text,
    '    const input = (await request.json()) as Record<string, unknown>;',
    '    await enforceRateLimit(`crm:public-meeting:${token}:${clientIp(request)}`, 20, 3600);\n    const input = await readJsonObject(request, 50_000);',
    `${file} bounded body`,
  );
  write(file, text);
}

// ---- Public chat: validate generated token shape, distributed throttling,
// bounded UTF-8 body, object-only JSON.
{
  const file = 'apps/web/src/app/api/crm/lead-acquisition/public/chat/[token]/route.ts';
  let text = read(file);
  text = replaceOnce(
    text,
    'import { HttpError, ok } from "@/core/http";',
    'import { HttpError, ok } from "@/core/http";\nimport { directCaptureFingerprint, enforceRateLimit, readRequestBytes } from "@/core/security";',
    `${file} security import`,
  );
  if (!text.includes('async function readJsonObject(')) {
    const marker = 'import { directCaptureFingerprint, enforceRateLimit, readRequestBytes } from "@/core/security";\n';
    text = replaceOnce(text, marker, `${marker}\nasync function readJsonObject(request: Request, maximumBytes: number) {\n  const bytes = await readRequestBytes(request, maximumBytes);\n  const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);\n  let parsed: unknown;\n  try {\n    parsed = JSON.parse(raw);\n  } catch {\n    throw new HttpError(400, "Invalid JSON request.");\n  }\n  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {\n    throw new HttpError(400, "Invalid JSON request.");\n  }\n  return parsed as Record<string, unknown>;\n}\n`, `${file} JSON helper`);
  }
  text = replaceOnce(
    text,
    '    const { token } = await route.params;\n    const input = (await request.json()) as Record<string, unknown>;',
    '    const { token } = await route.params;\n    if (!/^[0-9a-f]{48}$/i.test(token)) {\n      throw new HttpError(404, "Chat connection not found.");\n    }\n    const fingerprint = directCaptureFingerprint(request);\n    await enforceRateLimit(`crm:public-chat:ip:${fingerprint}`, 120, 60);\n    const input = await readJsonObject(request, 50_000);\n    await enforceRateLimit(`crm:public-chat:${token}:${fingerprint}`, 60, 60);',
    `${file} request boundary`,
  );
  write(file, text);
}

// ---- Inbound email: fail closed in production when the shared secret is not
// configured. Keep local/dev convenience while making production configuration mandatory.
{
  const file = 'apps/web/src/app/api/crm/lead-acquisition/public/email/[token]/route.ts';
  let text = read(file);
  const old = `    const { token } = await params;\n    const requiredSecret = process.env.CRM_INBOUND_EMAIL_SECRET || "";\n    if (requiredSecret && request.headers.get("x-vercentlabs-email-secret") !== requiredSecret)\n      throw new HttpError(401, "Inbound email secret is invalid.");`;
  const replacement = `    const { token } = await params;\n    if (!/^[0-9a-f]{48}$/i.test(token))\n      throw new HttpError(404, "Inbound-email connection not found.");\n    const requiredSecret = (process.env.CRM_INBOUND_EMAIL_SECRET || "").trim();\n    if (process.env.NODE_ENV === "production" && requiredSecret.length < 32)\n      throw new HttpError(503, "Inbound email authentication is not configured.");\n    if (requiredSecret && request.headers.get("x-vercentlabs-email-secret") !== requiredSecret)\n      throw new HttpError(401, "Inbound email secret is invalid.");`;
  text = replaceOnce(text, old, replacement, `${file} production secret gate`);
  write(file, text);
}

// ---- Entitlement-gate every server-rendered CRM page/data boundary that still
// used the synchronous crmContext(). The audited call sites are all async.
const gateTargets = [
  'apps/web/src/app/(app)/crm/[resource]/page.tsx',
  'apps/web/src/app/(app)/crm/activities/page.tsx',
  'apps/web/src/app/(app)/crm/assignment-rules/page.tsx',
  'apps/web/src/app/(app)/crm/forecast/page.tsx',
  'apps/web/src/app/(app)/crm/leads/[id]/page.tsx',
  'apps/web/src/app/(app)/crm/lost-reasons/page.tsx',
  'apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx',
  'apps/web/src/app/(app)/crm/page.tsx',
  'apps/web/src/app/(app)/crm/pipeline/page.tsx',
  'apps/web/src/app/(app)/crm/reports/page.tsx',
  'apps/web/src/app/(app)/search/page.tsx',
  'apps/web/src/orchestration/integrations.ts',
];
for (const file of gateTargets) {
  let text = read(file);
  if (!text.includes('crmContext')) continue;
  text = text.replace(/\bcrmContext\b/g, 'crmApiContext');
  text = text.replace(/(?<!await )crmApiContext\(session\)/g, 'await crmApiContext(session)');
  write(file, text);
}

// Keep the exported sync mapper private-to-wrapper in practice by correcting its
// stale comment. Removing it entirely is a larger API-surface refactor and is not
// needed to close the server-page entitlement gap.
{
  const file = 'apps/web/src/modules/crm/index.ts';
  let text = read(file);
  text = text.replace(
`// The API-boundary variant of crmContext(): every CRM API route (web +\n// mobile v1) uses this instead of the bare, synchronous crmContext() so the\n// module-enablement/entitlement gate (Part 5, docs/implementation/\n// ERP_MODULE_ENFORCEMENT_005.md) runs before any CRM data is read or\n// written. Server-rendered CRM pages under apps/web/src/app/(app)/crm/**\n// intentionally keep calling the sync crmContext() directly — see that\n// doc's "Remaining Gaps" section for why SSR page reads are out of scope\n// here.`,
`// Entitlement-gated CRM context used by API routes, server-rendered CRM pages,\n// search and orchestration boundaries. crmContext() remains the synchronous\n// mapper used only after module accessibility has been established.`,
  );
  write(file, text);
}

// Product-language cleanup for known user-facing implementation IDs / jargon.
{
  const replacements = new Map([
    ['F013 uses the device dialer only. No telephony provider or recording is implied.', 'Calls use the device dialer only. No telephony provider or recording is implied.'],
    ['F014 schedules governed CRM Meetings. Public booking links and synced calendars remain connected through the existing calendar workflow.', 'Meetings are scheduled and tracked in CRM. Public booking links and synced calendars remain connected through the calendar workflow.'],
    ['No stakeholders added yet — coverage gap.', 'No stakeholders have been added yet.'],
    ['F010 · Historical baseline', 'Historical pipeline baseline'],
  ]);
  for (const file of [
    'apps/mobile/src/modules/crm/components/create-record-sheet.tsx',
    'apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-workspace-tabs.tsx',
    'apps/web/src/modules/crm/components/pipeline-history-panel.tsx',
  ]) {
    let text = read(file);
    for (const [before, after] of replacements) text = text.split(before).join(after);
    write(file, text);
  }
}
NODE

section "3/8 Add CRM-specific validation and regression tests"

mkdir -p scripts/validation apps/web/tests docs/03-modules/crm/refactor

cat > scripts/validation/verify-crm-rebuild.mjs <<'MJS'
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const warnings = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

const booking = read("apps/web/src/app/api/crm/public/meetings/[token]/bookings/route.ts");
if (/new Map</.test(booking)) fail("Public meeting booking still uses a process-local Map rate limiter.");
if (!/enforceRateLimit/.test(booking)) fail("Public meeting booking is missing distributed rate limiting.");
if (/request\.json\(\)/.test(booking)) fail("Public meeting booking still parses an unbounded JSON body.");

const chat = read("apps/web/src/app/api/crm/lead-acquisition/public/chat/[token]/route.ts");
if (/request\.json\(\)/.test(chat)) fail("Public chat still parses an unbounded JSON body.");
if (!/readRequestBytes/.test(chat) || !/enforceRateLimit/.test(chat)) fail("Public chat hardening is incomplete.");

const inbound = read("apps/web/src/app/api/crm/lead-acquisition/public/email/[token]/route.ts");
if (!/NODE_ENV === "production"/.test(inbound) || !/requiredSecret\.length < 32/.test(inbound)) {
  fail("Inbound email does not fail closed on missing/weak production secret configuration.");
}

const pageRoot = path.join(root, "apps/web/src/app/(app)/crm");
for (const relative of fs.readdirSync(pageRoot, { recursive: true })) {
  if (!String(relative).endsWith("page.tsx")) continue;
  const file = path.join(pageRoot, String(relative));
  const source = fs.readFileSync(file, "utf8");
  if (/[^.\w]crmContext\(session\)/.test(source)) {
    fail(`${path.relative(root, file)} still uses the un-gated crmContext(session).`);
  }
}
for (const file of ["apps/web/src/app/(app)/search/page.tsx", "apps/web/src/orchestration/integrations.ts"]) {
  const source = read(file);
  if (/[^.\w]crmContext\(session\)/.test(source)) fail(`${file} still uses un-gated crmContext(session).`);
}

const apiRoot = path.join(root, "apps/web/src/app/api/crm");
let directSqlRoutes = 0;
for (const relative of fs.readdirSync(apiRoot, { recursive: true })) {
  if (!String(relative).endsWith("route.ts")) continue;
  const source = fs.readFileSync(path.join(apiRoot, String(relative)), "utf8");
  if (/\bclient\.query\s*\(|\bquery\s*</.test(source)) directSqlRoutes += 1;
}
if (directSqlRoutes > 0) warn(`${directSqlRoutes} CRM route handlers still contain direct persistence/query calls; these require semantic service-layer refactors.`);

for (const [file, limit] of [
  ["services/api/src/modules/crm/index.js", 1000],
  ["apps/web/src/modules/crm/index.ts", 1000],
  ["apps/web/src/modules/crm/components/leads-workspace.tsx", 700],
  ["apps/web/src/modules/crm/components/lead-detail-workspace.tsx", 700],
]) {
  const lines = read(file).split(/\r?\n/).length;
  if (lines > limit) warn(`${file} is ${lines} lines; semantic decomposition is still required.`);
}

if (warnings.length) {
  console.log("CRM rebuild warnings:");
  for (const item of warnings) console.log(`  WARN: ${item}`);
}
if (failures.length) {
  console.error("CRM rebuild validation failed:");
  for (const item of failures) console.error(`  ERROR: ${item}`);
  process.exit(1);
}
console.log("CRM deterministic rebuild safeguards: PASS");
MJS

cat > apps/web/tests/crm-rebuild-hardening.test.mjs <<'MJS'
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("public meeting booking uses distributed rate limiting and bounded JSON", () => {
  const source = read("apps/web/src/app/api/crm/public/meetings/[token]/bookings/route.ts");
  assert.doesNotMatch(source, /new Map</);
  assert.match(source, /enforceRateLimit/);
  assert.match(source, /readRequestBytes/);
  assert.doesNotMatch(source, /request\.json\(\)/);
});

test("public chat validates generated token shape, throttles, and bounds request bodies", () => {
  const source = read("apps/web/src/app/api/crm/lead-acquisition/public/chat/[token]/route.ts");
  assert.match(source, /\^\[0-9a-f\]\{48\}\$/);
  assert.match(source, /enforceRateLimit/);
  assert.match(source, /readRequestBytes/);
  assert.doesNotMatch(source, /request\.json\(\)/);
});

test("inbound email fails closed on missing production authentication", () => {
  const source = read("apps/web/src/app/api/crm/lead-acquisition/public/email/[token]/route.ts");
  assert.match(source, /NODE_ENV === "production"/);
  assert.match(source, /requiredSecret\.length < 32/);
  assert.match(source, /Inbound email authentication is not configured/);
});
MJS

# Replace the stale module-enforcement test text with a real SSR entitlement assertion.
node <<'NODE'
const fs = require('node:fs');
const file = 'apps/web/tests/module-enforcement.test.mjs';
let text = fs.readFileSync(file, 'utf8');
const before = `test("crm: server-rendered pages under app/(app)/crm/** intentionally still use the un-gated sync crmContext (documented remaining gap, not a missed call site)", () => {\n  const pagesDir = path.join(root, "apps/web/src/app/(app)/crm");\n  const pageFiles = fs.readdirSync(pagesDir, { recursive: true }).filter((f) => f.endsWith("page.tsx"));\n  assert.ok(pageFiles.length > 0, "expected CRM page.tsx files to exist");\n});`;
const after = `test("crm: server-rendered CRM pages use the entitlement-gated crmApiContext", () => {\n  const pagesDir = path.join(root, "apps/web/src/app/(app)/crm");\n  const pageFiles = fs.readdirSync(pagesDir, { recursive: true }).filter((f) => String(f).endsWith("page.tsx"));\n  assert.ok(pageFiles.length > 0, "expected CRM page.tsx files to exist");\n  let gated = 0;\n  for (const relative of pageFiles) {\n    const source = fs.readFileSync(path.join(pagesDir, String(relative)), "utf8");\n    assert.doesNotMatch(source, /[^.\\w]crmContext\\(session\\)/, String(relative) + " must not use un-gated crmContext(session)");\n    if (/crmApiContext\\(session\\)/.test(source)) {\n      gated += 1;\n      assert.match(source, /await crmApiContext\\(session\\)/, String(relative) + " must await the entitlement gate");\n    }\n  }\n  assert.ok(gated >= 8, "expected the CRM server pages with data access to use crmApiContext");\n});`;
if (text.includes(after)) process.exit(0);
if (!text.includes(before)) throw new Error('module-enforcement test block did not match the audited snapshot');
text = text.replace(before, after);
fs.writeFileSync(file, text, 'utf8');
NODE

section "4/8 Add CRM CI and root verification command"

cat > .github/workflows/crm-ci.yml <<'YAML'
name: CRM CI

on:
  pull_request:
    paths:
      - "apps/web/src/app/(app)/crm/**"
      - "apps/web/src/app/api/crm/**"
      - "apps/web/src/app/api/mobile/v1/crm/**"
      - "apps/web/src/modules/crm/**"
      - "apps/web/tests/crm*"
      - "apps/mobile/src/**/crm/**"
      - "services/api/src/modules/crm/**"
      - "services/api/tests/crm*"
      - "services/worker/src/**crm**"
      - "database/**/migrations/**crm**"
      - "packages/permissions/**"
      - "packages/shared-types/**"
      - "scripts/validation/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - ".github/workflows/crm-ci.yml"
  push:
    branches: [main]
    paths:
      - "apps/web/src/app/(app)/crm/**"
      - "apps/web/src/app/api/crm/**"
      - "apps/web/src/modules/crm/**"
      - "services/api/src/modules/crm/**"
      - "database/**/migrations/**crm**"
      - ".github/workflows/crm-ci.yml"

permissions:
  contents: read

concurrency:
  group: crm-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  crm-verification:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: "pnpm"
      - name: Enable Corepack
        run: corepack enable
      - name: Activate repository pnpm
        run: corepack prepare pnpm@11.21.0 --activate
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Verify CRM
        run: pnpm verify:crm
      - name: Dependency audit
        run: pnpm audit:dependencies
YAML

node <<'NODE'
const fs = require('node:fs');
const file = 'package.json';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.scripts ||= {};
pkg.scripts['verify:crm:static'] = [
  'node scripts/validation/verify-crm-rebuild.mjs',
  'node scripts/validation/verify-web-boundaries.mjs',
  'node scripts/validation/verify-architecture.mjs',
  'node scripts/validation/verify-db-structure.mjs',
  'node apps/web/scripts/verify-routes.mjs',
  'node --test apps/web/tests/crm-rebuild-hardening.test.mjs apps/web/tests/module-enforcement.test.mjs',
].join(' && ');
pkg.scripts['verify:crm'] = [
  'corepack pnpm verify:crm:static',
  'corepack pnpm typecheck:web',
  'corepack pnpm lint:web',
  'corepack pnpm test:web',
  'corepack pnpm test:api',
].join(' && ');
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
NODE

section "5/8 Write the remaining semantic rebuild ledger"

cat > docs/03-modules/crm/refactor/CRM_REBUILD_AUTOMATION.md <<'MD'
# CRM rebuild automation status

This file is generated by `vercentlabs-crm-rebuild.sh` from the September 10, 2026 audit baseline.

## Closed automatically in this pass

- Server-rendered CRM data access now uses the entitlement-gated `crmApiContext()` at the audited call sites.
- Public meeting booking no longer relies on a process-local JavaScript `Map` rate limiter.
- Public meeting booking JSON is byte-bounded before parsing.
- Public lead chat validates the generated token shape, has distributed throttling, and byte-bounds JSON before parsing.
- Production inbound-email ingestion fails closed if `CRM_INBOUND_EMAIL_SECRET` is absent or shorter than 32 characters.
- Known user-facing F-number/engineering-language leakage identified by the audit is removed.
- CRM now has a dedicated GitHub Actions quality gate and root `verify:crm` command.
- A CRM-specific rebuild validator and regression tests guard these fixes.

## Must be semantically rebuilt, not blind-codemodded

These remain intentional hard gates because a one-shot text rewrite cannot determine the correct product semantics safely:

- Split `services/api/src/modules/crm/index.js` into the eight approved CRM capabilities and shrink the public root surface.
- Split `apps/web/src/modules/crm/index.ts` and eliminate the parallel `features/`, flat `components/`, and flat `server/` ownership axes.
- Remove direct SQL/business orchestration from CRM Next.js route handlers and move it into typed capability commands/queries/repositories.
- Rebuild the multi-thousand-line Lead workspaces and other oversized client components around reusable list, Record-360, form, state, timeline, and action primitives.
- Replace the large CRM global CSS estate with the shared design system, semantic tokens, local modules, accessibility primitives, and responsive layouts.
- Redesign CRM information architecture around Home, Customers, Pipeline, Work, Inbox, Insights, and Setup; derive desktop/mobile navigation from one canonical semantic manifest.
- Implement a first-class My Work queue and first-class Inbox destination instead of relying on hidden/secondary activity tabs.
- Replace synchronous row-by-row import with durable asynchronous staged/batched import/export jobs and progress/retry semantics.
- Finish territories/coverage, dashboards, forecast snapshot/history/backtesting, and governed reports.
- Classify every CRM-created table KEEP / REBUILD / FUTURE / DELETE; rebaseline the pre-adoption CRM schema only after environment ownership is confirmed.
- Remove dormant customer-success, telephony/conversation-intelligence, marketing-execution, partner-engagement, AI-intelligence and other schema that has no supported current runtime owner.
- Converge permission identifiers/contracts across web, API, mobile and cross-module handoff policies.
- Add behavioral browser/device coverage, negative authorization tests, concurrency/conflict tests, performance tests, accessibility certification, localization extraction and observability gates.

## Safety rule

Do not mark the CRM redesign complete while the validator only reports warnings for oversized modules/direct route persistence. Those warnings represent semantic refactors that require deliberate code design, not regex replacement.
MD

section "6/8 Run dependency-free source validation"

node scripts/validation/verify-crm-rebuild.mjs
node scripts/validation/verify-web-boundaries.mjs
node scripts/validation/verify-db-structure.mjs
node apps/web/scripts/verify-routes.mjs
node scripts/validation/verify-architecture.mjs
node --test apps/web/tests/crm-rebuild-hardening.test.mjs apps/web/tests/module-enforcement.test.mjs
git diff --check

section "7/8 Optional repository-native full verification"

FULL_VERIFY_STATUS="skipped"
if [[ "$NODE_MAJOR" == "24" ]] && corepack pnpm --version >/dev/null 2>&1 && [[ -d node_modules || -d .pnpm ]]; then
  echo "Node 24 and installed workspace dependencies detected; running pnpm verify:crm."
  if corepack pnpm verify:crm; then
    FULL_VERIFY_STATUS="passed"
  else
    echo "WARN: full dependency-heavy verification failed. Source changes remain on the isolated rebuild branch for inspection."
    FULL_VERIFY_STATUS="failed"
  fi
else
  echo "Skipping dependency-heavy verification because Node 24 and/or installed workspace dependencies were not detected."
  echo "The new GitHub CRM CI workflow will run the complete install + verify:crm path on push/PR."
fi

section "8/8 Generate report"

CHANGED_COUNT="$(git status --porcelain --untracked-files=all | wc -l | tr -d ' ')"
{
  echo "# Vercentlabs CRM rebuild run"
  echo
  echo "- Run: $STAMP"
  echo "- Original HEAD: \`$ORIGINAL_HEAD\`"
  echo "- Backup tag: \`$BACKUP_TAG\`"
  echo "- Working branch: \`$WORK_BRANCH\`"
  echo "- Node: \`$(node -v 2>/dev/null || echo missing)\`"
  echo "- Full dependency verification: **$FULL_VERIFY_STATUS**"
  echo "- Changed/untracked paths after pass: **$CHANGED_COUNT**"
  if [[ -n "$STASH_CREATED" ]]; then
    echo "- Pre-existing work preserved in stash: \`$STASH_CREATED\`"
  fi
  echo
  echo "## Diff stat"
  echo
  echo '```text'
  git diff --stat
  echo '```'
  echo
  echo "## Validation"
  echo
  echo "Dependency-free CRM rebuild validator, web-boundary validator, DB validator, route verifier, architecture validator, focused regression tests, and \`git diff --check\` all passed."
  echo
  echo "See \`docs/03-modules/crm/refactor/CRM_REBUILD_AUTOMATION.md\` for the semantic rebuild work that cannot safely be replaced by blind source rewriting."
} > "$REPORT_FILE"

SUCCESS=1
trap - ERR INT TERM

echo
echo "CRM one-command pass completed successfully."
echo "Backup tag: $BACKUP_TAG"
echo "Working branch: $WORK_BRANCH"
echo "Report: $REPORT_FILE"
echo "Log: $LOG_FILE"
if [[ -n "$STASH_CREATED" ]]; then
  echo "Pre-existing work is preserved in stash: $STASH_CREATED"
fi
echo
echo "Changed files:"
git status --short
