import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ---------------------------------------------------------------------
// Part 50 — context switching.
// ---------------------------------------------------------------------

test("context: switching company clears the previously-selected branch (auto-resets to the new company's first branch, not a stale id)", () => {
  const source = read("apps/web/src/core/components/context-switcher.tsx");
  assert.match(source, /availableBranches = useMemo\(\s*\(\) => branches\.filter\(\(branch\) => branch\.company_id === companyId\)/);
});

test("context: companies and branches are server-scoped to the user's own access before ever reaching the client — not filtered only in the browser", () => {
  const source = read("apps/web/src/core/platform.ts");
  assert.match(
    source,
    /FROM companies c\s*WHERE c\.organization_id = \$1 AND c\.status = 'active'\s*AND \(\$3::boolean OR EXISTS \(\s*SELECT 1 FROM membership_company_access/,
  );
  assert.match(
    source,
    /FROM branches b\s*WHERE b\.organization_id = \$1 AND b\.status = 'active'\s*AND \(\$3::boolean OR EXISTS \(\s*SELECT 1 FROM membership_branch_access/,
  );
});

test("context: command palette re-searches (or clears) under the new context on every company/branch switch — the record-search effect depends on contextKey, not just query", () => {
  const source = read("apps/web/src/core/components/command-palette.tsx");
  assert.match(source, /\}, \[query, contextKey\]\);/);
});

test("context: switching context triggers a real server revalidation (router.refresh), not a client-only state patch", () => {
  const source = read("apps/web/src/core/components/context-switcher.tsx");
  assert.match(source, /router\.refresh\(\)/);
});

test("context: organisation switch redirects through a server-issued destination (result.next), never a client-constructed path", () => {
  const source = read("apps/web/src/core/components/context-switcher.tsx");
  assert.match(source, /router\.replace\(result\.next \|\| "\/dashboard"\)/);
});

// ---------------------------------------------------------------------
// Part 51 — top bar pure state/registry logic.
// ---------------------------------------------------------------------

test("topbar: notifications control routes to the existing /notifications page as its 'View all' destination, and only mutates via the existing PATCH contract", () => {
  const source = read("apps/web/src/core/components/notifications-control.tsx");
  assert.match(source, /href="\/notifications"/);
  assert.match(source, /method: "PATCH"/);
  assert.doesNotMatch(source, /method: "DELETE"|method: "PUT"/);
});

test("topbar: notifications preview is scoped to the caller's own row — the GET handler delegates to the shared listMyNotifications() helper (Prompt 8), which filters by (organization_id, user_id), same as the existing page and PATCH handler", () => {
  const route = read("apps/web/src/app/api/notifications/route.ts");
  const getHandler = route.split("export async function GET")[1]?.split("export async function PATCH")[0] ?? "";
  assert.match(getHandler, /listMyNotifications\(/);
  const helper = read("apps/web/src/orchestration/work/notifications.ts");
  assert.match(helper, /WHERE organization_id=\$1 AND user_id=\$2/);
});

test("topbar: settings/administration visibility is permission-derived (Security appears in the topbar unconditionally because /security's own personal password/sessions section still has no gate beyond authentication — confirmed, not assumed). Prompt 10 added an ADDITIONAL org-wide overview section, conditionally rendered only for auditView holders, but the page itself never calls notFound()/redirect based on a permission check, so it never blocks any authenticated member from opening it.", () => {
  const securityPage = read("apps/web/src/app/(app)/security/page.tsx");
  assert.doesNotMatch(securityPage, /notFound\(\)|redirect\(/, "if /security ever blocks the whole page behind a permission check, the topbar's unconditional Security link must be revisited");
  assert.match(securityPage, /hasPermission\(session, PERMISSIONS\.auditView\)/, "the org-wide overview section is still expected to be conditionally gated");
});

test("topbar: profile menu's sign-out reuses the existing LogoutButton (real session invalidation via /api/auth/logout), not a new client-only implementation", () => {
  const source = read("apps/web/src/core/components/profile-menu.tsx");
  assert.match(source, /import LogoutButton from "@\/core\/components\/logout-button";/);
  assert.match(source, /<LogoutButton /);
  assert.doesNotMatch(source, /localStorage\.(removeItem|clear)|document\.cookie\s*=/, "must not attempt to clear session state client-side");
});

test("topbar: Quick Create's visible action set for the profile-menu/notifications/quick-create trio all close on outside click or Escape via one shared hook, not three separate implementations", () => {
  const hookSource = read("apps/web/src/shared/use-outside-dismiss.ts");
  assert.match(hookSource, /event\.key === "Escape"/);
  for (const file of ["profile-menu.tsx", "notifications-control.tsx", "quick-create-button.tsx"]) {
    const source = read(`apps/web/src/core/components/${file}`);
    assert.match(source, /import \{ useOutsideDismiss \} from "@\/shared\/use-outside-dismiss";/, `${file} must reuse the shared dismiss hook`);
  }
});

test("topbar: no destructive-sounding control exists in the always-visible topbar action set", () => {
  const appShellSource = read("apps/web/src/core/components/app-shell.tsx");
  assert.doesNotMatch(appShellSource, /Delete workspace|Deactivate|Terminate/i);
});
