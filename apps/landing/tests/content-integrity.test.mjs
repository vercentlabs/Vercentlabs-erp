import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CTAS, PRIMARY_NAV, LANDING_MODULES, COMPANY_IDENTITY } from "@vercentlabs/landing-content";

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, "..");

test("no CTA has an empty destination", () => {
  for (const [key, cta] of Object.entries(CTAS)) {
    assert.ok(cta.href && cta.href.startsWith("/"), `CTA "${key}" has an invalid href: "${cta.href}"`);
  }
});

test("PRIMARY_NAV has no empty or placeholder ('#') hrefs, including nested children", () => {
  function checkHref(href, context) {
    assert.ok(href && href !== "#" && href.startsWith("/"), `${context} has an invalid href: "${href}"`);
  }
  for (const item of PRIMARY_NAV) {
    checkHref(item.href, item.label);
    for (const child of item.children ?? []) {
      checkHref(child.href, `${item.label} > ${child.label}`);
    }
  }
});

test("every module resolves to a unique /modules/{key} route", () => {
  const routes = LANDING_MODULES.map((module) => `/modules/${module.key}`);
  assert.equal(new Set(routes).size, routes.length, "two modules resolve to the same route");
});

/**
 * Static-source check (not an import) for components/layout/footer.tsx, since it
 * contains JSX and can't be executed directly by plain `node --test` — see
 * docs/landing-redesign/phase-2/component-inventory.md's testing note.
 */
test("footer source contains no '#' placeholder links", () => {
  const footerSource = readFileSync(path.join(appDir, "components", "layout", "footer.tsx"), "utf8");
  assert.ok(!/href="#"/.test(footerSource), "footer.tsx contains a href=\"#\" placeholder link");
});

test("provisioned company contact addresses stay on the verified domain", () => {
  const expected = {
    primaryContactEmail: "sales@vercentlabs.com",
    salesContactEmail: "sales@vercentlabs.com",
    supportContactEmail: "support@vercentlabs.com",
    privacyContactEmail: "privacy@vercentlabs.com",
    securityContactEmail: "security@vercentlabs.com",
    careersContactEmail: "careers@vercentlabs.com",
    billingContactEmail: "billing@vercentlabs.com",
  };

  assert.equal(COMPANY_IDENTITY.primaryContactEmail, COMPANY_IDENTITY.salesContactEmail);

  for (const [field, email] of Object.entries(expected)) {
    assert.equal(COMPANY_IDENTITY[field], email);
  }
});

test("footer exposes every approved customer-facing role address", () => {
  const footerSource = readFileSync(path.join(appDir, "components", "layout", "footer.tsx"), "utf8");
  for (const field of [
    "salesContactEmail",
    "supportContactEmail",
    "privacyContactEmail",
    "securityContactEmail",
    "careersContactEmail",
    "billingContactEmail",
  ]) {
    assert.ok(footerSource.includes(field), `footer.tsx does not expose COMPANY_IDENTITY.${field}`);
  }
});

test("footer source never claims a certification, social profile, or review badge", () => {
  const footerSource = readFileSync(path.join(appDir, "components", "layout", "footer.tsx"), "utf8");
  const bannedTerms = ["twitter.com", "linkedin.com", "facebook.com", "SOC 2", "ISO 27001", "★"];
  for (const term of bannedTerms) {
    assert.ok(
      !footerSource.includes(term),
      `footer.tsx references "${term}" — this must be real and verified, not asserted by this phase (Evidence and Honesty Rules)`,
    );
  }
});

test("no component or page under app/ or components/ references a fabricated statistic pattern", () => {
  const suspiciousPatterns = [/\d+% faster/i, /trusted by \d/i, /\d+\+? customers/i, /\d\.\d out of 5/i];
  const roots = [path.join(appDir, "app"), path.join(appDir, "components")];
  const offenders = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts"))) {
        const source = readFileSync(fullPath, "utf8");
        for (const pattern of suspiciousPatterns) {
          if (pattern.test(source)) offenders.push(`${fullPath} matched ${pattern}`);
        }
      }
    }
  }

  for (const root of roots) walk(root);
  assert.deepEqual(offenders, []);
});

/**
 * Regression guard for a real Phase 2 P0: Tailwind v4's CSS-variable
 * shorthand uses parens (`bg-(--token)`), not square brackets (`bg-[--token]`).
 * The bracket form compiles to invalid CSS with no build error and no lint
 * error — it silently produced a transparent mega-menu panel with hero text
 * showing through it, only caught by visual inspection (see
 * docs/landing-redesign/phase-2/decision-log.md item 4d, which explicitly
 * recommended this exact check as unfinished follow-up work).
 */
test("no Tailwind class string uses the invalid bracket-CSS-variable syntax (bg-[--x] instead of bg-(--x))", () => {
  const suspiciousPattern = /\b[a-z-]+-\[--[a-z-]+\]/;
  const roots = [path.join(appDir, "app"), path.join(appDir, "components")];
  const offenders = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts") || entry.name.endsWith(".css"))) {
        const source = readFileSync(fullPath, "utf8");
        if (suspiciousPattern.test(source)) offenders.push(fullPath);
      }
    }
  }

  for (const root of roots) walk(root);
  assert.deepEqual(offenders, [], "found bracket-syntax CSS-variable references — use bg-(--token) instead of bg-[--token]");
});
