import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve("src");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const redesignedRoutes = [
  "app/about/page.tsx",
  "app/api-developers/page.tsx",
  "app/book-demo/page.tsx",
  "app/careers/page.tsx",
  "app/changelog/page.tsx",
  "app/comparison/page.tsx",
  "app/contact/page.tsx",
  "app/customers/page.tsx",
  "app/features/page.tsx",
  "app/help/page.tsx",
  "app/how-it-works/page.tsx",
  "app/industries/page.tsx",
  "app/industries/[slug]/page.tsx",
  "app/login/page.tsx",
  "app/modules/page.tsx",
  "app/modules/[slug]/page.tsx",
  "app/partner/page.tsx",
  "app/pricing/page.tsx",
  "app/privacy/page.tsx",
  "app/product/page.tsx",
  "app/security/page.tsx",
  "app/signup/verify/page.tsx",
  "app/status/page.tsx",
  "app/terms/page.tsx",
  "app/workflows/page.tsx",
];

test("all public supporting routes use the operator design system", () => {
  for (const route of redesignedRoutes) {
    const source = read(route);
    assert.match(
      source,
      /Operator|StructuredContentPage|LegalPage/,
      `${route} is not connected to the operator system`,
    );
  }
});

test("the supporting-page system removes legacy rounded SaaS card language", () => {
  const system = [
    read("components/marketing/operator-page.tsx"),
    read("components/marketing/structured-content-page.tsx"),
    read("components/marketing/legal-page.tsx"),
    read("components/forms/lead-form.tsx"),
  ].join("\n");

  assert.doesNotMatch(system, /rounded-(?:xl|2xl|3xl)/);
  assert.doesNotMatch(system, /shadow-(?:sm|md|lg|xl|2xl)/);
  assert.match(read("app/globals.css"), /\.operator-band/);
  assert.match(read("app/globals.css"), /\.operator-form-layout/);
  assert.match(read("app/globals.css"), /@media \(max-width: 760px\)/);
  assert.match(read("app/globals.css"), /prefers-reduced-motion: reduce/);
});

test("released, foundation and roadmap states remain explicit", () => {
  const modules = read("app/modules/page.tsx");
  const detail = read("app/modules/[slug]/page.tsx");
  const pricing = read("app/pricing/page.tsx");

  assert.match(modules, /status=\{released \? "released" : "roadmap"\}/);
  assert.match(detail, /cannot be activated in the current release/);
  assert.match(pricing, /CRM and business master data/);
  assert.match(pricing, /Roles, permissions and audit history/);
});
