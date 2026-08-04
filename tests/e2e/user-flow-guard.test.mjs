import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("hidden administration pages deny direct access before loading data", () => {
  const users = read("apps/web/src/app/(app)/settings/users/page.tsx");
  assert.match(users, /PERMISSIONS\.usersView\)\) notFound\(\)/);
  assert.ok(
    users.indexOf("PERMISSIONS.usersView") < users.indexOf("await Promise.all"),
    "users.view must be checked before user data is queried",
  );

  const settings = read(
    "apps/web/src/app/(app)/settings/[resource]/page.tsx",
  );
  assert.match(
    settings,
    /hasPermission\(session, definition\.permission\)\) notFound\(\)/,
  );
  assert.ok(
    settings.indexOf("definition.permission") <
      settings.indexOf("listResource(resource"),
    "resource permission must be checked before settings data is loaded",
  );
});

test("CRM permission denials never render a blank protected page", () => {
  for (const file of [
    "apps/web/src/app/(app)/crm/page.tsx",
    "apps/web/src/app/(app)/crm/reports/page.tsx",
  ]) {
    const source = read(file);
    assert.doesNotMatch(source, /return null;/);
    assert.match(source, /notFound\(\)/);
  }
});

test("web and mobile expose complete organisation switching", () => {
  const shell = read("apps/web/src/lib/platform.ts");
  assert.match(shell, /const organizations = await query/);
  assert.match(shell, /return \{\s*organizations,/);

  const webSwitcher = read("apps/web/src/components/context-switcher.tsx");
  assert.match(webSwitcher, /\/api\/context\/organization/);

  const mobileClient = read("packages/shared-sdk/src/mobile.js");
  assert.match(mobileClient, /setWorkspaceOrganization/);

  const mobileRoute = read(
    "apps/web/src/app/api/mobile/v1/workspace/organization/route.ts",
  );
  assert.match(mobileRoute, /active_organization_id = \$3/);
  assert.match(mobileRoute, /membership\.status = 'active'/);
});

test("mobile authentication uses web URLs and blocks workspace-less sessions", () => {
  const loginScreen = read("apps/mobile/src/app/(auth)/login.tsx");
  assert.match(loginScreen, /appConfig\.webAppUrl}\/forgot-password/);
  assert.match(loginScreen, /appConfig\.webAppUrl}\/signup/);
  assert.doesNotMatch(loginScreen, /appConfig\.apiUrl}\/forgot-password/);

  const loginRoute = read(
    "apps/web/src/app/api/mobile/v1/auth/login/route.ts",
  );
  assert.match(loginRoute, /workspace_not_configured/);
  assert.match(loginRoute, /Complete organisation setup/);
});

test("critical client mutations use resilient JSON requests", () => {
  const critical = [
    "accept-invitation-form.tsx",
    "change-password-form.tsx",
    "session-manager.tsx",
    "user-administration.tsx",
    "crm-lead-actions.tsx",
    "crm-opportunity-actions.tsx",
    "notification-list.tsx",
    "profile-form.tsx",
  ];
  for (const file of critical) {
    const source = read(`apps/web/src/components/${file}`);
    assert.match(source, /requestJson/);
  }
});

test("account creation and invitations complete their intended journeys", () => {
  const signup = read("apps/web/src/components/signup-form.tsx");
  assert.match(signup, /router\.(?:push|replace)\(result\.next\)/);

  const invitation = read(
    "apps/web/src/components/accept-invitation-form.tsx",
  );
  assert.match(invitation, /!existingUser \? \(/);

  const validation = read("apps/web/src/lib/validation.ts");
  assert.match(validation, /fullName: z\.string\(\)\.trim\(\)\.max\(100\)/);
});
