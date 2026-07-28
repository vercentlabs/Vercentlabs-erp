import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("demo and contact are distinct truthful delivery journeys", () => {
  const form = read("src/components/forms/lead-form.tsx");
  const validation = read("src/lib/lead-validation.ts");
  const delivery = read("src/lib/lead-delivery.ts");
  const demoRoute = read("src/app/api/demo/route.ts");
  const legacyRoute = read("src/app/api/signup/route.ts");
  const received = read("src/app/request-received/page.tsx");
  const legacyPage = read("src/app/signup/verify/page.tsx");

  assert.match(form, /fetch\(isDemo \? "\/api\/demo" : "\/api\/contact"/);
  assert.match(
    form,
    /window\.location\.assign\("\/request-received\?kind=demo"\)/,
  );
  assert.match(validation, /LeadKind = "contact" \| "demo"/);
  assert.match(delivery, /"demo\.requested"/);
  assert.match(delivery, /DEMO_CRM_CAPTURE_URL/);
  assert.match(demoRoute, /handleLeadRequest\(request, "demo"\)/);
  assert.match(legacyRoute, /Deprecation/);
  assert.match(received, /No trial, account or implementation commitment/);
  assert.match(legacyPage, /redirect\("\/request-received"\)/);
  assert.doesNotMatch(received, /signed email link|verification token/i);
});

test("public product, implementation and workflow copy stays inside release scope", () => {
  const product = read("src/app/product/page.tsx");
  const implementation = read("src/app/how-it-works/page.tsx");
  const workflows = read("src/app/workflows/page.tsx");

  for (const source of [product, implementation, workflows]) {
    assert.match(source, /roadmap/i);
    assert.match(source, /current|released/i);
  }

  assert.match(product, /Eight operational modules remain explicit roadmap/);
  assert.match(
    implementation,
    /does not claim a generic multi-level approval designer/,
  );
  assert.match(workflows, /Four business modules are released/);
  assert.match(workflows, /cannot be completed in the current release/);
  assert.doesNotMatch(implementation, /Connected modules are updated/);
  assert.doesNotMatch(
    workflows,
    /Transform customer interest into collected revenue/,
  );
});

test("pricing never promises a trial when secure registration is unavailable", () => {
  const pricing = read("src/app/pricing/page.tsx");
  assert.match(
    pricing,
    /siteConfig\.appUrl \? "Start 14-day trial" : "Request early access"/,
  );
  assert.match(pricing, /: "\/book-demo"/);
  assert.match(pricing, /Roadmap modules are quoted only after they pass/);
});

test("metadata, status and error surfaces use the current operator identity", () => {
  const manifest = read("src/app/manifest.ts");
  const icon = read("src/app/icon.tsx");
  const openGraph = read("src/app/opengraph-image.tsx");
  const loading = read("src/app/loading.tsx");
  const error = read("src/app/error.tsx");
  const notFound = read("src/app/not-found.tsx");
  const schema = read("src/components/seo/organization-json-ld.tsx");
  const status = read("src/app/status/page.tsx");

  assert.match(manifest, /theme_color: "#0c0f12"/);
  assert.match(manifest, /src: "\/icon"/);
  assert.match(icon, /VL/);
  assert.match(openGraph, /Run the work\. Keep the truth\./);
  assert.match(openGraph, /08 roadmap modules/);
  assert.match(loading, /operator-state-page/);
  assert.match(error, /operator-state-page/);
  assert.match(notFound, /OperatorBand/);
  assert.match(schema, /absoluteUrl\("\/icon"\)/);
  assert.match(status, /PublicStatusCheck/);
  assert.match(
    read("src/components/marketing/public-status-check.tsx"),
    /The public health check timed out/,
  );
});

test("sitemap covers every indexable public route", () => {
  const sitemap = read("src/app/sitemap.ts");
  for (const route of [
    "/book-demo",
    "/customers",
    "/status",
    "/workflows",
    "/api-developers",
    "/partner",
    "/careers",
    "/changelog",
  ]) {
    assert.match(sitemap, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(sitemap, /new Date\("2026-07-12"\)/);
});

test("navigation and product preview are keyboard-operable without false controls", () => {
  const header = read("src/components/layout/header.tsx");
  const shell = read("src/components/marketing/marketing-shell.tsx");
  const demo = read("src/components/home/operating-system-demo.tsx");

  assert.match(header, /aria-modal="true"/);
  assert.match(header, /event\.key !== "Tab"/);
  assert.match(header, /window\.requestAnimationFrame/);
  assert.match(header, /className="skip-link"/);
  assert.doesNotMatch(shell, /className="skip-link"/);
  assert.match(demo, /ArrowRight/);
  assert.match(demo, /ArrowLeft/);
  assert.match(demo, /onKeyDown/);
  assert.match(demo, /Illustrative workflow · synthetic data/);
  assert.doesNotMatch(demo, /aria-label="Search preview"/);
});

test("production landing validation allows pre-registration mode but requires secure providers", () => {
  const validator = read(
    "../../scripts/deployment/validate-production-env.mjs",
  );
  assert.match(validator, /if \(value\("NEXT_PUBLIC_ERP_APP_URL"\)\)/);
  assert.match(validator, /requireHttps\("UPSTASH_REDIS_REST_URL"\)/);
  assert.match(validator, /requireHttps\("LEAD_WEBHOOK_URL"\)/);
});

test("production journey verification is part of the release workflow", () => {
  const rootPackage = read("../../package.json");
  const landingPackage = read("package.json");
  const workflow = read("../../.github/workflows/release-readiness.yml");
  const verifier = read("scripts/verify-production-journeys.mjs");
  const browserVerifier = read("scripts/verify-browser-journeys.mjs");
  const deploymentSmoke = read("../../scripts/deployment/smoke-deployment.mjs");

  assert.match(rootPackage, /"test:landing:e2e"/);
  assert.match(
    rootPackage,
    /build:landing && corepack pnpm test:landing:e2e && corepack pnpm test:landing:browser && corepack pnpm lint:web/,
  );
  assert.match(landingPackage, /"test:e2e"/);
  assert.match(landingPackage, /"test:browser"/);
  assert.match(landingPackage, /"@playwright\/test": "1\.61\.1"/);
  assert.match(
    landingPackage,
    /pnpm test && pnpm lint && pnpm typecheck && pnpm build && pnpm test:e2e/,
  );
  assert.match(workflow, /pnpm test:landing:e2e/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /pnpm test:landing:browser/);
  assert.match(verifier, /signed CRM delivery/);
  assert.match(verifier, /internalLinks/);
  assert.match(verifier, /Internal link \$\{href\} returned/);
  assert.match(verifier, /invalidContentType/);
  assert.match(verifier, /missingProxy/);
  assert.match(verifier, /oversizedJson/);
  assert.match(verifier, /honeypot/);
  assert.match(verifier, /retry-after/);
  assert.match(browserVerifier, /assertNoHorizontalOverflow/);
  assert.match(browserVerifier, /Skip to main content/);
  assert.match(browserVerifier, /Approve preview/);
  assert.match(browserVerifier, /fillContactForm/);
  assert.match(browserVerifier, /fillDemoForm/);
  assert.match(browserVerifier, /reducedMotion: "reduce"/);
  assert.match(deploymentSmoke, /SMOKE_LEAD_EMAIL/);
  assert.match(deploymentSmoke, /Live landing delivery accepted/);
  assert.match(deploymentSmoke, /Landing security header missing/);
});
