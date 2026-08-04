import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const repositoryRoot = path.resolve(mobileRoot, "../..");
const read = (relativePath) =>
  fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");

function pageRoutes(root, prefix = "") {
  const routes = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith("(")) {
      if (entry.isDirectory())
        routes.push(...pageRoutes(path.join(root, entry.name), prefix));
      continue;
    }
    if (entry.isDirectory())
      routes.push(
        ...pageRoutes(path.join(root, entry.name), `${prefix}/${entry.name}`),
      );
    else if (entry.name === "page.tsx") routes.push(prefix || "/");
  }
  return routes;
}

test("every protected web page family has an explicit mobile destination", () => {
  const webRoot = path.join(repositoryRoot, "apps/web/src/app/(app)");
  const routes = pageRoutes(webRoot).sort();
  const manifest = read("src/core/modules/web-parity.ts");
  for (const route of routes) {
    assert.match(
      manifest,
      new RegExp(
        `web: ["']${route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
      ),
      `${route} is missing from the parity contract`,
    );
  }
  const protectedEntries = manifest.slice(
    manifest.indexOf("export const protectedWebParity"),
    manifest.indexOf("export const authenticationWebParity"),
  );
  assert.match(
    protectedEntries,
    /web: "\/accounting"[\s\S]*?secure-browser-handoff/,
  );
  assert.match(
    protectedEntries,
    /web: "\/sales"[\s\S]*?secure-browser-handoff/,
  );
  assert.match(protectedEntries, /web: "\/crm"[\s\S]*?delivery: "native"/);
});

test("workspace navigation contains no disabled or web-only destination", () => {
  const navigation = read("src/core/modules/navigation.ts");
  assert.doesNotMatch(navigation, /web-required|availability/);
  for (const destination of [
    "master-data",
    "billing",
    "audit-logs",
    "organization",
    "companies",
    "branches",
    "departments",
    "teams",
    "cost-centres",
    "users",
    "roles",
    "numbering-series",
  ]) {
    assert.match(
      navigation,
      new RegExp(`key: ["']${destination}["'][\\s\\S]{0,200}?href:`),
      `${destination} must resolve natively`,
    );
  }
});

test("native parity APIs preserve bearer auth and browser CSRF boundaries", () => {
  const security = fs.readFileSync(
    path.join(repositoryRoot, "apps/web/src/lib/security.ts"),
    "utf8",
  );
  const auth = fs.readFileSync(
    path.join(repositoryRoot, "apps/web/src/lib/auth.ts"),
    "utf8",
  );
  assert.match(security, /assertSameOriginOrMobile/);
  assert.match(security, /x-vercentlabs-client/);
  assert.match(auth, /resolveSessionContext\(bearer, "mobile"\)/);
  for (const endpoint of [
    "workspace/route.ts",
    "catalog/route.ts",
    "settings/[resource]/route.ts",
    "business-data/[resource]/route.ts",
    "workspace/[area]/route.ts",
    "approvals/[id]/route.ts",
    "exports/[area]/[resource]/route.ts",
    "imports/crm/[resource]/route.ts",
  ]) {
    assert.ok(
      fs.existsSync(
        path.join(repositoryRoot, "apps/web/src/app/api/mobile/v1", endpoint),
      ),
      `${endpoint} is required`,
    );
  }
});

test("native workspaces expose the responsive web actions instead of route-only placeholders", () => {
  const workspace = read("src/shared/components/workspace-page.tsx");
  const resources = read("src/shared/components/resource-manager-screen.tsx");
  const catalog = read("src/app/(protected)/workspace/[area].tsx");
  const billing = read("src/shared/components/billing-manager.tsx");

  for (const area of [
    "dashboard",
    "crm",
    "profile",
    "security",
    "billing",
    "approvals",
    "audit-logs",
    "crm-reports",
    "users",
    "roles",
    "modules",
  ]) {
    assert.match(
      workspace,
      new RegExp(`area === ["']${area}["']`),
      `${area} needs a native workspace implementation`,
    );
  }
  for (const action of [
    "archiveWorkspaceResource",
    "completeActivity",
    "/exports/",
    "/imports/crm/",
    "Export CSV",
    "Import CSV",
    "Open",
  ]) {
    assert.match(
      resources,
      new RegExp(action.replaceAll("/", "\\/")),
      `${action} must stay available from native record lists`,
    );
  }
  assert.match(catalog, /masterDataOverview/);
  assert.match(catalog, /Roles & permissions/);
  assert.match(billing, /RazorpayCheckout\.open/);
  assert.match(billing, /Open invoice/);
});

test("mobile shell carries the responsive web design contract", () => {
  const tokens = read("src/shared/theme/tokens.ts");
  const theme = read("src/shared/theme/theme.tsx");
  const header = read("src/shared/components/app-header.tsx");
  for (const color of [
    "#0B1220",
    "#101828",
    "#344054",
    "#667085",
    "#E4E7EC",
    "#F4F6FA",
    "#4F46E5",
    "#3730A3",
    "#EEF2FF",
    "#0891B2",
    "#067647",
    "#B54708",
    "#B42318",
  ]) {
    assert.match(
      tokens,
      new RegExp(color, "i"),
      `${color} must remain aligned with apps/web`,
    );
  }
  assert.match(theme, /dark: false/);
  assert.match(header, /Open navigation menu/);
  assert.match(header, /Search partners, items, companies, branches or users/);
  assert.match(header, /destinationIsActive/);
  assert.match(header, /#C7D2FE/i);
  assert.match(header, /picker === "organization"/);
  assert.match(header, /Select\{" "\}/);
  assert.match(read("src/shared/components/brand-mark.tsx"), />\s*V\s*</);
  assert.match(
    read("src/app/(protected)/(tabs)/_layout.tsx"),
    /display: "none"/,
  );
});

test("physical Android launch cannot reuse an older Metro bundle", () => {
  const launcher = fs.readFileSync(
    path.join(repositoryRoot, "scripts/mobile/android-phone.ps1"),
    "utf8",
  );
  assert.match(launcher, /Stop-Process/);
  assert.match(launcher, /"--clear"/);
  assert.match(launcher, /WorkingDirectory \$repoRoot/);
  assert.match(launcher, /WebAppUrl = "http:\/\/127\.0\.0\.1:3001"/);
  assert.doesNotMatch(
    read("src/core/config/index.ts"),
    /(?:10\.0\.2\.2|localhost):3000/,
  );
});
