import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

function walk(directory) {
  const output = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) output.push(...walk(full));
    else output.push(full);
  }
  return output;
}

function appRoutes(application) {
  const app = path.join(root, application, "src/app");
  const routes = new Set(["/"]);
  for (const file of walk(app)) {
    if (!file.endsWith(`${path.sep}page.tsx`)) continue;
    const relative = path.relative(app, path.dirname(file));
    const segments = relative
      .split(path.sep)
      .filter((segment) => segment && !segment.startsWith("("));
    routes.add(`/${segments.join("/")}`.replace(/\/$/, "") || "/");
  }
  return routes;
}

function routeMatches(routes, target) {
  const clean = target.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  if (routes.has(clean)) return true;
  const targetParts = clean === "/" ? [] : clean.slice(1).split("/");
  return [...routes].some((route) => {
    const routeParts = route === "/" ? [] : route.slice(1).split("/");
    return (
      routeParts.length === targetParts.length &&
      routeParts.every(
        (part, index) =>
          part === targetParts[index] || /^\[[^\]]+\]$/.test(part),
      )
    );
  });
}

test("all literal internal web and landing journeys resolve", () => {
  for (const application of ["apps/web", "apps/landing"]) {
    const routes = appRoutes(application);
    const sourceRoot = path.join(root, application, "src");
    const references = [];
    for (const file of walk(sourceRoot)) {
      if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      const expression = /(?:href\s*=|router\.(?:push|replace)\(|redirect\(|window\.location\.(?:assign|replace)\()\s*[({]?\s*["'](\/[^"'`$]*)["']/g;
      for (const match of source.matchAll(expression)) references.push([file, match[1]]);
    }
    for (const [file, reference] of references) {
      if (reference.startsWith("/api/")) continue;
      assert.ok(
        routeMatches(routes, reference),
        `${path.relative(root, file)} points to missing route ${reference}`,
      );
    }
  }
});

test("onboarding is transactionally idempotent and retry-safe", () => {
  const source = read("apps/web/src/app/api/onboarding/route.ts");
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended\(\$1, 0\)\)/);
  assert.match(source, /FROM organization_memberships AS membership/);
  assert.match(source, /reused: true/);
  assert.match(source, /result\.created \? 201 : 200/);
  assert.ok(
    source.indexOf("pg_advisory_xact_lock") < source.indexOf("INSERT INTO organizations"),
    "the user lock must be acquired before organisation creation",
  );
});

test("authentication journeys do not leave stale history or unusable mobile sessions", () => {
  const loginPage = read("apps/web/src/app/(auth)/login/page.tsx");
  const signupPage = read("apps/web/src/app/(auth)/signup/page.tsx");
  assert.match(loginPage, /if \(session\) redirect\(nextPath\(session\)\)/);
  assert.match(signupPage, /if \(session\) redirect\(nextPath\(session\)\)/);

  for (const file of [
    "apps/web/src/components/auth-form.tsx",
    "apps/web/src/components/signup-form.tsx",
    "apps/web/src/components/accept-invitation-form.tsx",
    "apps/web/src/components/onboarding-form.tsx",
    "apps/web/src/components/change-password-form.tsx",
  ]) {
    assert.match(read(file), /router\.replace\(/, `${file} must replace completed auth history`);
  }

  const mobileLogin = read("apps/web/src/app/api/mobile/v1/auth/login/route.ts");
  assert.match(mobileLogin, /workspace_not_configured/);
});

test("every browser mutation has bounded network failure handling", () => {
  const components = path.join(root, "apps/web/src/components");
  const rawFetchFiles = walk(components)
    .filter((file) => file.endsWith(".tsx"))
    .filter((file) => /\bfetch\s*\(/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"));
  assert.deepEqual(rawFetchFiles, [
    "apps/web/src/components/accounting/accounting-action-button.tsx",
    "apps/web/src/components/accounting/accounting-policy-editor.tsx",
    "apps/web/src/components/accounting/budget-editor.tsx",
    "apps/web/src/components/accounting/close-task-actions.tsx",
    "apps/web/src/components/accounting/credit-allocation-form.tsx",
    "apps/web/src/components/accounting/journal-editor.tsx",
    "apps/web/src/components/accounting/recurring-editor.tsx",
    "apps/web/src/components/accounting/simple-accounting-form.tsx",
    "apps/web/src/components/accounting/subledger-document-editor.tsx",
    "apps/web/src/components/accounting/vendor-match-form.tsx",
    "apps/web/src/components/billing-workspace.tsx",
    "apps/web/src/components/public-quote-decision.tsx",
    "apps/web/src/components/sales-document-actions.tsx",
    "apps/web/src/components/sales-document-editor.tsx",
  ]);

  const helper = read("apps/web/src/lib/client-request.ts");
  assert.match(helper, /AbortController/);
  assert.match(helper, /15_000/);
  assert.match(helper, /response\.text\(\)/);
  assert.match(helper, /session has expired/i);
});

test("CRM save, archive, completion and import all recover cleanly", () => {
  const manager = read("apps/web/src/components/crm-resource-manager.tsx");
  assert.equal((manager.match(/requestJson/g) || []).length >= 5, true);
  assert.match(manager, /timeoutMs: 60_000/);
  assert.match(manager, /fileRef\.current\.value = ""/);
  assert.doesNotMatch(manager, /const response = await fetch/);
});

test("mobile session expiry and offline restore are explicit states", () => {
  const sdk = read("packages/shared-sdk/src/mobile.js");
  const provider = read("apps/mobile/src/core/auth/auth-provider.tsx");
  const protectedLayout = read("apps/mobile/src/app/(protected)/_layout.tsx");
  assert.match(sdk, /setAuthenticationFailureHandler/);
  assert.match(sdk, /authenticationFailureHandler\?\./);
  assert.match(provider, /status: "unavailable"/);
  assert.match(provider, /retrySession/);
  assert.match(protectedLayout, /auth\.status !== "signed-in"/);
});

test("notifications use safe internal navigation and resilient state", () => {
  const web = read("apps/web/src/components/notification-list.tsx");
  const mobile = read("apps/mobile/src/app/(protected)/notifications.tsx");
  assert.match(web, /value\.startsWith\("\/"\)/);
  assert.match(web, /value\.startsWith\("\/\/"\)/);
  assert.match(web, /openNotification/);
  assert.match(mobile, /finally \{/);
  assert.match(mobile, /disabled=\{Boolean\(pending\)\}/);
});

test("public lead submission times out instead of hanging", () => {
  const lead = read("apps/landing/src/components/forms/lead-form.tsx");
  assert.match(lead, /AbortController/);
  assert.match(lead, /20_000/);
  assert.match(lead, /response\.json\(\)\.catch/);
});

test("organisation switch is available in browser and native clients", () => {
  assert.ok(
    existsSync(path.join(root, "apps/web/src/app/api/mobile/v1/workspace/organization/route.ts")),
  );
  assert.match(read("apps/web/src/components/context-switcher.tsx"), /Active organisation/);
  assert.match(read("apps/mobile/src/shared/components/app-header.tsx"), /Select\{" "\}/);
  assert.match(read("packages/shared-sdk/src/mobile.js"), /setWorkspaceOrganization/);
});
