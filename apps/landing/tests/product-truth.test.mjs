import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPANY_IDENTITY, CTAS } from "@vercentlabs/landing-content";
import {
  ORGANIZATION_ID,
  SOFTWARE_APPLICATION_ID,
  WEBSITE_ID,
  editorialAttributionJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "../lib/seo/json-ld.ts";
import {
  APPROVED_SCREENSHOTS,
  getApprovedScreenshot,
} from "../lib/product/screenshots.ts";

const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// Captured 2026-08-06/07 from the ERP UI replaced in the 2026-09-14 frontend
// rebuild. A recapture from the current UI must use a new file (and is free to
// keep or change the id) — these specific captures may never be approved again.
const OBSOLETE_UI_SCREENSHOT_SOURCES = new Set([
  "/product/crm-pipeline-board.png",
  "/product/crm-leads-list.png",
  "/product/sales-quotation-detail.png",
  "/product/sales-order-detail.png",
  "/product/stock-overview.png",
  "/product/accounting-dashboard.png",
  "/product/procurement-orders-list.png",
  "/product/manufacturing-dashboard.png",
  "/product/projects-dashboard.png",
  "/product/assets-dashboard.png",
  "/product/quality-dashboard.png",
  "/product/support-dashboard.png",
  "/product/hr-payroll-dashboard.png",
  "/product/point-of-sale-dashboard.png",
]);

test("no screenshot of the replaced ERP UI is approved as marketing evidence", () => {
  for (const screenshot of APPROVED_SCREENSHOTS) {
    if (OBSOLETE_UI_SCREENSHOT_SOURCES.has(screenshot.src)) {
      assert.equal(
        screenshot.approvedForMarketing,
        false,
        `${screenshot.id} shows the replaced ERP UI and must not be approved`,
      );
      assert.equal(
        getApprovedScreenshot(screenshot.id),
        null,
        `${screenshot.id} must not resolve as approved evidence`,
      );
    }
  }
});

test("structured data separates the organization (Vercentlabs) from the product (Vercentlabs ERP)", () => {
  const organization = organizationJsonLd();
  assert.equal(organization["@type"], "Organization");
  assert.equal(organization["@id"], ORGANIZATION_ID);
  assert.equal(organization.name, "Vercentlabs");
  assert.equal(organization.legalName, COMPANY_IDENTITY.legalName);
  for (const invented of [
    "address",
    "foundingDate",
    "numberOfEmployees",
    "sameAs",
    "taxID",
    "aggregateRating",
  ]) {
    assert.equal(
      organization[invented],
      undefined,
      `Organization must not carry unevidenced "${invented}"`,
    );
  }

  const website = websiteJsonLd();
  assert.equal(website["@id"], WEBSITE_ID);
  assert.deepEqual(website.publisher, { "@id": ORGANIZATION_ID });

  const product = softwareApplicationJsonLd("Description");
  assert.equal(product["@type"], "SoftwareApplication");
  assert.equal(product["@id"], SOFTWARE_APPLICATION_ID);
  assert.equal(product.name, "Vercentlabs ERP");
  assert.deepEqual(product.creator, { "@id": ORGANIZATION_ID });
  assert.deepEqual(product.publisher, { "@id": ORGANIZATION_ID });
  assert.equal(
    product.offers,
    undefined,
    "no pricing is published, so no Offer may be declared",
  );

  const attribution = editorialAttributionJsonLd("Vercentlabs Product Team");
  assert.deepEqual(attribution.author.parentOrganization, {
    "@id": ORGANIZATION_ID,
  });
  assert.deepEqual(attribution.publisher, { "@id": ORGANIZATION_ID });
});

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

const APP_SOURCES = ["app", "components", "lib"].flatMap((directory) =>
  sourceFiles(path.join(appRoot, directory)),
);

test("app source has no historical requirement counts, inline Organization entities, or dead product-tour links", () => {
  const violations = [];
  for (const file of APP_SOURCES) {
    const source = readFileSync(file, "utf8");
    const relative = path.relative(appRoot, file);
    for (const [pattern, reason] of [
      [
        /\b991\b|\b897\b|documented requirements|requirementCount|getTotalRequirementCount/i,
        "historical 991/897 requirement allocation",
      ],
      [/\/product-tour\b/, "link to the non-existent /product-tour route"],
      [
        /offline-(ready|capable)|native mobile app\b(?! at launch)|webhooks|telephony/i,
        "native/offline mobile or integration claim",
      ],
    ]) {
      if (pattern.test(source)) violations.push(`${relative}: ${reason}`);
    }
    if (
      relative !== path.join("lib", "seo", "json-ld.ts") &&
      /"@type":\s*"Organization"/.test(source)
    ) {
      violations.push(
        `${relative}: declares an inline Organization entity instead of referencing ORGANIZATION_ID`,
      );
    }
  }
  assert.deepEqual(violations, []);
});

test("every navigation CTA points at a real route", () => {
  for (const [key, cta] of Object.entries(CTAS)) {
    const [pathname] = cta.href.split("?");
    const routeDir = path.join(
      appRoot,
      "app",
      ...pathname.split("/").filter(Boolean),
    );
    const hasPage = (() => {
      try {
        return statSync(path.join(routeDir, "page.tsx")).isFile();
      } catch {
        return false;
      }
    })();
    assert.ok(hasPage, `CTAS.${key} links to ${cta.href}, which has no page`);
  }
});
