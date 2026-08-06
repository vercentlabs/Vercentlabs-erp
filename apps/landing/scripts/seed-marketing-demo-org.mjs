#!/usr/bin/env node
/**
 * seed-marketing-demo-org.mjs
 *
 * Drives the REAL Vercentlabs ERP application (apps/web) through Playwright to
 * create a brand-new, obviously-synthetic demo organization and populate it
 * with a coherent "lead to cash" workflow (CRM lead -> opportunity ->
 * quotation -> sales order, plus a supplier -> purchase order -> goods
 * receipt loop in Procurement). Every record is created through real,
 * server-validated application forms and API routes — nothing is written
 * directly to the database with SQL.
 *
 * This script exists purely to produce demo data for marketing screenshots
 * (see apps/landing/scripts/capture-marketing-screenshots.mjs). It must
 * NEVER be run against a production environment or against the real
 * "VercentLabs" organization.
 *
 * Safety:
 *  - Refuses to run if NODE_ENV === "production".
 *  - Refuses to run if the target URL is not localhost/127.0.0.1.
 *  - Creates a brand-new organization/user every run (not idempotent by
 *    design — re-running produces a second demo org rather than mutating an
 *    existing one). It never touches the pre-existing "VercentLabs" org.
 *
 * Usage:
 *   node apps/landing/scripts/seed-marketing-demo-org.mjs
 *
 * Env overrides:
 *   DEMO_BASE_URL   - defaults to http://localhost:3001
 *   DEMO_HEADLESS   - "false" to watch the browser run
 */

import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BASE_URL = process.env.DEMO_BASE_URL || "http://localhost:3001";
const HEADLESS = process.env.DEMO_HEADLESS !== "false";

function assertSafeEnvironment() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run: NODE_ENV is 'production'. This script must never run against production.",
    );
  }
  const host = new URL(BASE_URL).hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(
      `Refusing to run: target host '${host}' is not localhost. This script must only run against a local dev server.`,
    );
  }
}

const REAL_ORG_ID = "babdf49c-00ad-4531-a5bd-56437255b2c3";

function log(step, message) {
  console.log(`[seed] ${step} :: ${message}`);
}

// ---------------------------------------------------------------------------
// Synthetic demo identity. Fictional throughout — never a real customer,
// person, phone number or email.
// ---------------------------------------------------------------------------
const RUN_SUFFIX = Date.now().toString(36);
const DEMO_USER = {
  fullName: "Asha Kapoor",
  email: `demo.manufacturing+${RUN_SUFFIX}@vercent-demo.local`,
  password: "Vd3mo!Manufact2026#Seed",
};
// A second synthetic team member with the "Purchase Manager" role. Real
// segregation-of-duties controls in Procurement forbid the creator of a
// supplier/purchase-order/receipt from also approving it (see
// transitionProcurementRecord's self-approval check in services/api). This
// second account exists purely so the demo can exercise the real approval
// actions rather than skip them.
const DEMO_APPROVER = {
  fullName: "Vikram Patel",
  email: `demo.procurement.approver+${RUN_SUFFIX}@vercent-demo.local`,
  password: "Vd3mo!Approver2026#Seed",
};
const DEMO_ORG = {
  organizationName: "Vercent Demo Manufacturing",
  legalCompanyName: "Vercent Demo Manufacturing Pvt Ltd",
  companyCode: "VDM",
  branchName: "Head Office",
  branchCode: "HO",
  countryCode: "IN",
  timezone: "Asia/Kolkata",
  baseCurrency: "INR",
  fiscalYearStartMonth: "4",
};

const ITEMS = [
  {
    code: "ITM-BRKT-01",
    name: "Precision Steel Bracket",
    itemType: "product",
    uom: "EA",
    salesPrice: "450",
    purchasePrice: "310",
    openingQty: "640",
  },
  {
    code: "ITM-VALV-01",
    name: "Hydraulic Valve Assembly",
    itemType: "product",
    uom: "EA",
    salesPrice: "12500",
    purchasePrice: "9200",
    openingQty: "45",
  },
  {
    code: "ITM-COUP-01",
    name: "Industrial Motor Coupling",
    itemType: "product",
    uom: "EA",
    salesPrice: "3200",
    purchasePrice: "2150",
    openingQty: "220",
  },
];

const WAREHOUSE = { code: "WH-01", name: "Main Warehouse" };

const LEADS = [
  {
    firstName: "Rohan",
    lastName: "Mehta",
    companyName: "Meridian Fabrication Works",
    jobTitle: "Procurement Head",
    email: "rohan.mehta@example.com",
    mobile: "9000000001",
    status: "new",
    estimatedValue: "1850000",
    industry: "Industrial Manufacturing",
    city: "Pune",
    state: "Maharashtra",
    convert: true,
  },
  {
    firstName: "Neha",
    lastName: "Bansal",
    companyName: "Solstice Tooling Pvt Ltd",
    jobTitle: "Plant Manager",
    email: "neha.bansal@example.com",
    mobile: "9000000002",
    status: "contacted",
    estimatedValue: "850000",
    industry: "Precision Tooling",
    city: "Coimbatore",
    state: "Tamil Nadu",
  },
  {
    firstName: "Vikram",
    lastName: "Sinha",
    companyName: "Ironclad Industrial Systems",
    jobTitle: "Operations Director",
    email: "vikram.sinha@example.com",
    mobile: "9000000003",
    status: "qualified",
    estimatedValue: "1400000",
    industry: "Heavy Equipment",
    city: "Ahmedabad",
    state: "Gujarat",
    convert: true,
  },
  {
    firstName: "Priya",
    lastName: "Nair",
    companyName: "Brightedge Engineering Co",
    jobTitle: "Buyer",
    email: "priya.nair@example.com",
    mobile: "9000000004",
    status: "contacted",
    estimatedValue: "1200000",
    industry: "Industrial Engineering",
    city: "Chennai",
    state: "Tamil Nadu",
  },
  {
    firstName: "Arjun",
    lastName: "Rao",
    companyName: "Falcon Precision Components",
    jobTitle: "VP Operations",
    email: "arjun.rao@example.com",
    mobile: "9000000005",
    status: "new",
    estimatedValue: "640000",
    industry: "Precision Components",
    city: "Bengaluru",
    state: "Karnataka",
  },
  {
    firstName: "Divya",
    lastName: "Menon",
    companyName: "Cascade Metalworks",
    jobTitle: "Purchase Manager",
    email: "divya.menon@example.com",
    mobile: "9000000006",
    status: "qualified",
    estimatedValue: "2100000",
    industry: "Metal Fabrication",
    city: "Nashik",
    state: "Maharashtra",
  },
];

const EXTRA_OPPORTUNITIES = [
  {
    name: "Solstice Tooling — Q3 Component Order",
    stage: "Needs analysis",
    amount: "850000",
    probability: "25",
  },
  {
    name: "Brightedge Engineering — Annual Supply Agreement",
    stage: "Value proposition",
    amount: "1200000",
    probability: "40",
  },
  {
    name: "Falcon Precision — Coupling Retrofit",
    stage: "Proposal",
    amount: "640000",
    probability: "60",
  },
  {
    name: "Cascade Metalworks — Plant Upgrade",
    stage: "Negotiation",
    amount: "2100000",
    probability: "80",
  },
];

const SUPPLIER = {
  supplierCode: "SUP-ALLOY-01",
  legalName: "Alloy Forge Suppliers Pvt Ltd",
  displayName: "Alloy Forge Suppliers",
  currencyCode: "INR",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fillNamed(page, name, value) {
  await page.locator(`[name="${name}"]`).first().fill(String(value));
}

async function selectNamed(page, name, labelSubstring) {
  const select = page.locator(`select[name="${name}"]`).first();
  await select.waitFor({ state: "visible" });
  const options = await select.locator("option").allTextContents();
  const match = options.find((text) =>
    text.toLowerCase().includes(labelSubstring.toLowerCase()),
  );
  if (!match) {
    throw new Error(
      `Could not find option containing "${labelSubstring}" for select[name="${name}"]. Options: ${options.join(", ")}`,
    );
  }
  await select.selectOption({ label: match });
}

async function checkNamed(page, name) {
  await page.locator(`input[name="${name}"]`).first().check();
}

/** Select an option on a plain (non-name-attributed) <select> by matching visible text. */
async function selectByVisibleText(selectLocator, textSubstring) {
  await selectLocator.waitFor({ state: "visible" });
  const options = await selectLocator.locator("option").allTextContents();
  const match = options.find((text) => text.toLowerCase().includes(textSubstring.toLowerCase()));
  if (!match) {
    throw new Error(
      `Could not find option containing "${textSubstring}". Options: ${options.join(", ")}`,
    );
  }
  await selectLocator.selectOption({ label: match });
}

/** Select the first non-placeholder option (index 1) — used when there is exactly
 * one plausible real choice and its label is a generated code we cannot predict.
 * These option lists load from an async fetch on mount (no name attribute to key
 * off), so retries with a page reload guard against the fetch racing the record
 * becoming visible under its filtered status (e.g. "active" suppliers only). */
async function selectFirstRealOption(page, selectLocator, { retries = 5, retryDelayMs = 1500 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await selectLocator.waitFor({ state: "visible" });
    const values = await selectLocator.locator("option").evaluateAll((options) =>
      options.map((option) => option.value),
    );
    const firstReal = values.find((value) => value !== "");
    if (firstReal) {
      await selectLocator.selectOption(firstReal);
      return;
    }
    if (attempt < retries) {
      await page.waitForTimeout(retryDelayMs);
      await page.reload({ waitUntil: "networkidle" });
    }
  }
  throw new Error("No non-empty option available to select after retries.");
}

/**
 * Click a procurement-record lifecycle action button (Submit, Approve, ...),
 * wait for its POST /actions response, then wait for the component's
 * follow-up GET (via requestJson's internal `load()`) to settle before the
 * next action is attempted — these buttons only appear once React state has
 * caught up with the new record status.
 */
async function runProcurementAction(page, label, { optional = false } = {}) {
  const button = page.getByRole("button", { name: label, exact: true });
  try {
    await button.waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    if (optional) return false;
    throw new Error(`Action button "${label}" never became visible.`);
  }
  await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/actions") && res.request().method() === "POST",
      { timeout: 15_000 },
    ),
    button.click(),
  ]);
  await page.waitForLoadState("networkidle");
  return true;
}

async function waitForJson(page, urlSubstring, action) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(urlSubstring) && res.request().method() === "POST",
      { timeout: 30_000 },
    ),
    action(),
  ]);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function main() {
  assertSafeEnvironment();
  log("guard", `Target ${BASE_URL} looks safe (non-production, localhost).`);

  const browser = await chromium.launch({ headless: HEADLESS });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on("dialog", (dialog) => dialog.accept());

  const summary = {
    orgId: null,
    orgName: DEMO_ORG.organizationName,
    userEmail: DEMO_USER.email,
    createdLeads: [],
    createdOpportunities: [],
    createdItems: [],
    warehouseId: null,
    quotationId: null,
    orderId: null,
    supplierCreated: false,
    purchaseOrderCreated: false,
    receiptCreated: false,
    stockMovementsPosted: 0,
    stepsCompleted: [],
    stepsFailed: [],
  };

  try {
    // -----------------------------------------------------------------
    // Step 1: signup, verify email, onboarding
    // -----------------------------------------------------------------
    log("signup", `Creating account for ${DEMO_USER.email}`);
    await page.goto(`${BASE_URL}/signup`, { waitUntil: "networkidle" });
    await fillNamed(page, "fullName", DEMO_USER.fullName);
    await fillNamed(page, "email", DEMO_USER.email);
    await page.locator('input[name="password"]').fill(DEMO_USER.password);
    await page.locator('input[name="confirmPassword"]').fill(DEMO_USER.password);

    const { body: signupBody } = await waitForJson(page, "/api/auth/signup", () =>
      page.getByRole("button", { name: "Create account" }).click(),
    );
    if (!signupBody.ok) throw new Error(`Signup failed: ${signupBody.message}`);
    const developmentUrl = signupBody.developmentUrl;
    if (!developmentUrl) throw new Error("Signup did not return a developmentUrl (email delivery may be configured).");
    summary.stepsCompleted.push("signup");

    log("verify", "Following development verification link");
    await page.goto(developmentUrl, { waitUntil: "networkidle" });
    await waitForJson(page, "/api/auth/verify-email", () =>
      page.getByRole("button", { name: "Verify email" }).click(),
    );
    await page.waitForURL("**/onboarding", { timeout: 15_000 });
    summary.stepsCompleted.push("verify-email");

    log("onboarding", `Creating organization "${DEMO_ORG.organizationName}"`);
    await fillNamed(page, "organizationName", DEMO_ORG.organizationName);
    await fillNamed(page, "legalCompanyName", DEMO_ORG.legalCompanyName);
    await fillNamed(page, "companyCode", DEMO_ORG.companyCode);
    await fillNamed(page, "branchName", DEMO_ORG.branchName);
    await fillNamed(page, "branchCode", DEMO_ORG.branchCode);
    await fillNamed(page, "countryCode", DEMO_ORG.countryCode);
    await fillNamed(page, "baseCurrency", DEMO_ORG.baseCurrency);
    await fillNamed(page, "timezone", DEMO_ORG.timezone);
    await waitForJson(page, "/api/onboarding", () =>
      page.getByRole("button", { name: "Create ERP workspace" }).click(),
    );
    await page.waitForURL("**/dashboard", { timeout: 30_000 });
    summary.stepsCompleted.push("onboarding");

    const shellOrgNameLocator = page.locator(".workspace-context strong").first();
    await shellOrgNameLocator.waitFor({ state: "visible", timeout: 15_000 });
    const shellOrgName = (await shellOrgNameLocator.textContent())?.trim();
    if (shellOrgName !== DEMO_ORG.organizationName) {
      throw new Error(
        `SAFETY ABORT: Active organization reads "${shellOrgName}", expected "${DEMO_ORG.organizationName}". Refusing to continue in case this landed in the wrong org.`,
      );
    }
    log("guard", `Confirmed active organization is "${DEMO_ORG.organizationName}" (never the real VercentLabs org, id ${REAL_ORG_ID}).`);

    // -----------------------------------------------------------------
    // Step 2a: master data — items and a warehouse
    // -----------------------------------------------------------------
    for (const item of ITEMS) {
      log("item", `Creating item ${item.code} — ${item.name}`);
      await page.goto(`${BASE_URL}/master-data/items`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Add item" }).click();
      await fillNamed(page, "code", item.code);
      await fillNamed(page, "name", item.name);
      await selectNamed(page, "itemType", "Product");
      await selectNamed(page, "uomId", item.uom);
      await checkNamed(page, "trackInventory");
      await fillNamed(page, "salesPrice", item.salesPrice);
      await fillNamed(page, "purchasePrice", item.purchasePrice);
      const { body: itemBody } = await waitForJson(page, "/api/business-data/items", () =>
        page.getByRole("button", { name: "Save record" }).click(),
      );
      if (itemBody.ok && itemBody.record?.id) {
        summary.createdItems.push({ ...item, id: itemBody.record.id });
      }
      await page.waitForTimeout(500);
    }
    summary.stepsCompleted.push("items");

    log("warehouse", `Creating warehouse ${WAREHOUSE.code}`);
    await page.goto(`${BASE_URL}/master-data/warehouses`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add warehouse" }).click();
    await selectNamed(page, "companyId", DEMO_ORG.organizationName).catch(() => {});
    await fillNamed(page, "name", WAREHOUSE.name);
    await fillNamed(page, "code", WAREHOUSE.code);
    await selectNamed(page, "warehouseType", "Stores");
    const { body: warehouseBody } = await waitForJson(page, "/api/business-data/warehouses", () =>
      page.getByRole("button", { name: "Save record" }).click(),
    );
    if (warehouseBody.ok && warehouseBody.record?.id) {
      summary.warehouseId = warehouseBody.record.id;
    }
    await page.waitForTimeout(500);
    summary.stepsCompleted.push("warehouse");

    // -----------------------------------------------------------------
    // Step 2a-2: opening stock.
    //
    // Note on a real product gap found while building this script: the
    // Stock module ships read-only list/dashboard views and a real,
    // permission-checked POST /api/stock/movements endpoint
    // (postStockMovement in services/api/src/stock/index.js), but no UI
    // form anywhere calls it — and Procurement's goods-receipt approval
    // (applyReceiptToOrder) only updates the purchase order's received
    // quantity, it does not post to tenant.stock_movements/stock_balances.
    // So there is currently no UI path at all to get a non-zero stock
    // balance. Rather than leave the Stock dashboard screenshot empty, this
    // calls the real endpoint the same way the app's own client code would
    // (an authenticated fetch from within the page, subject to the same
    // permission checks and ledger/valuation-layer writes) instead of
    // writing to the database directly.
    // -----------------------------------------------------------------
    if (summary.warehouseId && summary.createdItems.length) {
      log("stock", "Posting opening stock receipts (no UI form exists for this yet — see comment above)");
      await page.goto(`${BASE_URL}/stock`, { waitUntil: "networkidle" });
      for (const item of summary.createdItems) {
        const result = await page.evaluate(
          async ({ itemId, warehouseId, quantity, unitCost }) => {
            const response = await fetch("/api/stock/movements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                movementType: "receipt",
                itemId,
                warehouseId,
                quantity,
                unitCost,
                reason: "Opening stock for marketing demo data",
              }),
            });
            return response.json();
          },
          {
            itemId: item.id,
            warehouseId: summary.warehouseId,
            quantity: item.openingQty,
            unitCost: item.purchasePrice,
          },
        );
        if (result.ok) {
          summary.stockMovementsPosted += 1;
        } else {
          summary.stepsFailed.push(`stock-movement:${item.code}:${result.message}`);
        }
      }
      summary.stepsCompleted.push("opening-stock");
    }

    // -----------------------------------------------------------------
    // Step 2b: CRM leads
    // -----------------------------------------------------------------
    for (const lead of LEADS) {
      log("lead", `Creating lead ${lead.firstName} ${lead.lastName} (${lead.companyName})`);
      await page.goto(`${BASE_URL}/crm/leads?create=1`, { waitUntil: "networkidle" });
      await fillNamed(page, "firstName", lead.firstName);
      await fillNamed(page, "lastName", lead.lastName);
      await fillNamed(page, "companyName", lead.companyName);
      await fillNamed(page, "jobTitle", lead.jobTitle);
      await fillNamed(page, "email", lead.email);
      await fillNamed(page, "mobile", lead.mobile);
      await selectNamed(page, "status", lead.status).catch(() => {});
      await fillNamed(page, "estimatedValue", lead.estimatedValue);
      await selectNamed(page, "currencyCode", "INR").catch(() => {});
      await fillNamed(page, "industry", lead.industry);
      await fillNamed(page, "city", lead.city);
      await fillNamed(page, "state", lead.state);
      const { body } = await waitForJson(page, "/api/crm/leads", () =>
        page.getByRole("button", { name: "Save" }).click(),
      );
      if (!body.ok) {
        log("lead", `WARNING: failed to save lead ${lead.companyName}: ${body.message}`);
        summary.stepsFailed.push(`lead:${lead.companyName}`);
        continue;
      }
      summary.createdLeads.push({ ...lead, id: body.record?.id });
    }
    summary.stepsCompleted.push("leads");

    // -----------------------------------------------------------------
    // Step 2c: convert two leads into opportunities + customers
    // -----------------------------------------------------------------
    let meridianOpportunityId = null;
    let meridianPartyId = null;
    for (const lead of summary.createdLeads.filter((entry) => entry.convert && entry.id)) {
      log("convert", `Converting lead ${lead.companyName} to opportunity`);
      await page.goto(`${BASE_URL}/crm/leads/${lead.id}`, { waitUntil: "networkidle" });
      const { body } = await waitForJson(page, "/convert", () =>
        page.getByRole("button", { name: "Convert lead" }).click(),
      );
      if (!body.ok) {
        log("convert", `WARNING: failed to convert ${lead.companyName}: ${body.message}`);
        summary.stepsFailed.push(`convert:${lead.companyName}`);
        continue;
      }
      if (lead.companyName === "Meridian Fabrication Works") {
        meridianOpportunityId = body.conversion?.opportunityId || body.conversion?.opportunity?.id;
        meridianPartyId = body.conversion?.partyId || body.conversion?.party?.id;
      }
    }
    summary.stepsCompleted.push("lead-conversion");

    // -----------------------------------------------------------------
    // Step 2d: a few more opportunities directly, spread across stages
    // -----------------------------------------------------------------
    for (const opp of EXTRA_OPPORTUNITIES) {
      log("opportunity", `Creating opportunity "${opp.name}" in stage ${opp.stage}`);
      await page.goto(`${BASE_URL}/crm/opportunities?create=1`, { waitUntil: "networkidle" });
      await fillNamed(page, "name", opp.name);
      await selectNamed(page, "pipelineId", "Standard").catch(() => {});
      await selectNamed(page, "stageId", opp.stage).catch(() => {});
      await fillNamed(page, "amount", opp.amount);
      await selectNamed(page, "currencyCode", "INR").catch(() => {});
      await fillNamed(page, "probability", opp.probability);
      const { body } = await waitForJson(page, "/api/crm/opportunities", () =>
        page.getByRole("button", { name: "Save" }).click(),
      );
      if (!body.ok) {
        summary.stepsFailed.push(`opportunity:${opp.name}`);
        continue;
      }
      summary.createdOpportunities.push({ ...opp, id: body.record?.id });
    }
    summary.stepsCompleted.push("extra-opportunities");

    // -----------------------------------------------------------------
    // Step 2e: an address for the Meridian customer, so the sales order can
    // clear its "shipping address is required" readiness check later.
    // -----------------------------------------------------------------
    if (meridianPartyId) {
      log("address", "Creating a shipping/billing address for Meridian Fabrication Works");
      await page.goto(`${BASE_URL}/master-data/addresses`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Add address" }).click();
      await selectNamed(page, "partyId", "Meridian");
      await selectNamed(page, "addressType", "Shipping");
      await fillNamed(page, "line1", "Plot 14, MIDC Industrial Area");
      await fillNamed(page, "city", "Pune");
      await fillNamed(page, "state", "Maharashtra");
      await fillNamed(page, "postalCode", "411019");
      await fillNamed(page, "countryCode", "IN");
      await checkNamed(page, "isPrimary");
      await waitForJson(page, "/api/business-data/addresses", () =>
        page.getByRole("button", { name: "Save record" }).click(),
      ).catch((error) => {
        log("address", `WARNING: could not create customer address: ${error instanceof Error ? error.message : error}`);
        summary.stepsFailed.push("customer-address");
      });
      summary.stepsCompleted.push("customer-address");
    }

    // -----------------------------------------------------------------
    // Step 3: Sales — quotation from the Meridian opportunity, submit,
    // send, accept (via the real public quote decision page), convert to
    // a sales order, confirm the order.
    // -----------------------------------------------------------------
    if (meridianOpportunityId) {
      log("quotation", "Building quotation from the Meridian opportunity");
      await page.goto(`${BASE_URL}/sales/quotations/new?opportunityId=${meridianOpportunityId}`, {
        waitUntil: "networkidle",
      });
      await page.waitForSelector("text=Create quotation", { timeout: 20_000 });

      const lines = [
        { item: "Precision Steel Bracket", qty: "40", price: "450" },
        { item: "Hydraulic Valve Assembly", qty: "6", price: "12500" },
        { item: "Industrial Motor Coupling", qty: "12", price: "3200" },
      ];
      for (let i = 0; i < lines.length; i += 1) {
        if (i > 0) await page.getByRole("button", { name: "Add line" }).click();
        const card = page.locator(".sales-line-card").nth(i);
        await selectByVisibleText(card.locator("select").first(), lines[i].item);
        await card.getByLabel("Quantity").fill(lines[i].qty);
        await card.getByLabel("Unit price").fill(lines[i].price);
        await selectByVisibleText(card.getByLabel("Fulfilment warehouse"), WAREHOUSE.name).catch(() => {});
      }
      await selectByVisibleText(page.getByLabel("Billing address"), "Plot 14").catch(() => {});
      await selectByVisibleText(page.getByLabel("Shipping address"), "Plot 14").catch(() => {});
      const { body: quoteBody } = await waitForJson(page, "/api/sales/quotations", () =>
        page.getByRole("button", { name: "Create quotation" }).click(),
      );
      if (!quoteBody.ok) throw new Error(`Quotation creation failed: ${quoteBody.message}`);
      summary.quotationId = quoteBody.quotation?.id;
      summary.stepsCompleted.push("quotation-create");

      await page.waitForURL(`**/sales/quotations/${summary.quotationId}`, { timeout: 15_000 });
      log("quotation", "Submitting quotation for approval (auto-approves under threshold)");
      await waitForJson(page, "/actions", () => page.getByRole("button", { name: "Submit" }).click());
      await page.reload({ waitUntil: "networkidle" });

      log("quotation", "Sending quotation securely to obtain a public decision link");
      const { body: sendBody } = await waitForJson(page, "/actions", () =>
        page.getByRole("button", { name: "Send securely" }).click(),
      );
      let quoteToken = sendBody.result?.token;
      if (!quoteToken) {
        // Fall back to parsing the on-page message for the link.
        const messageText = await page.locator(".sales-action-message").first().textContent().catch(() => "");
        const match = messageText && messageText.match(/\/quote\/([A-Za-z0-9_-]+)/);
        if (match) quoteToken = match[1];
      }
      if (!quoteToken) throw new Error("Could not determine the public quote token after sending.");
      summary.stepsCompleted.push("quotation-send");

      log("quotation", "Recording customer acceptance via the real public decision page");
      const publicPage = await context.newPage();
      await publicPage.goto(`${BASE_URL}/quote/${quoteToken}`, { waitUntil: "networkidle" });
      await publicPage.getByLabel("Your name").fill("Rohan Mehta");
      await publicPage.getByLabel("Email").fill("rohan.mehta@example.com");
      await publicPage.getByLabel("Typed signature").fill("Rohan Mehta");
      await waitForJson(publicPage, "/api/public/sales/quotes/", () =>
        publicPage.getByRole("button", { name: "Accept quotation" }).click(),
      );
      await publicPage.close();
      summary.stepsCompleted.push("quotation-accept");

      log("quotation", "Converting the accepted quotation to a sales order");
      await page.goto(`${BASE_URL}/sales/quotations/${summary.quotationId}`, { waitUntil: "networkidle" });
      const { body: convertBody } = await waitForJson(page, "/actions", () =>
        page.getByRole("button", { name: "Create sales order" }).click(),
      );
      summary.orderId = convertBody.result?.orderId;
      summary.stepsCompleted.push("quotation-convert");

      if (summary.orderId) {
        await page.waitForURL(`**/sales/orders/${summary.orderId}`, { timeout: 15_000 });
        log("order", "Confirming the sales order");
        // Known, confirmed product bug (found while building this script, not
        // fixed here — out of scope for apps/landing): submitSalesOrder's
        // auto-approve path (services/api/src/sales/index.js, ~line 1642) sets
        // lifecycle_status='approved', but the sales_orders table's CHECK
        // constraint (database/tenant/migrations/008_sales_module.sql:278)
        // only allows draft/pending_approval/confirmed/on_hold/cancelled/closed
        // — 'approved' is missing from that enum. So the very first UPDATE
        // inside confirmSalesOrder throws a Postgres check-constraint
        // violation, which the route's generic catch-all reports as "The
        // request could not be completed." This means no sales order can be
        // confirmed via the app today, in any organization. Left as a
        // non-fatal, logged step so the order still gets captured (in
        // "draft" status, with its now-passing readiness panel) rather than
        // aborting the whole run.
        const { body: confirmBody } = await waitForJson(page, "/actions", () =>
          page.getByRole("button", { name: "Confirm order" }).click(),
        );
        if (!confirmBody.ok) {
          log("order", `WARNING (known product bug, see comment above): order confirmation failed: ${confirmBody.message}`);
          summary.stepsFailed.push(`order-confirm-known-bug:${confirmBody.message}`);
        } else {
          summary.stepsCompleted.push("order-confirm");
        }
      }
    } else {
      log("sales", "Skipped: no Meridian opportunity id was captured from lead conversion.");
      summary.stepsFailed.push("sales-flow:no-opportunity-id");
    }

    // -----------------------------------------------------------------
    // Step 4: Procurement — supplier, purchase order, goods receipt.
    //
    // Real segregation-of-duties controls forbid the creator of a
    // supplier/PO/receipt from also approving/qualifying it (see
    // transitionProcurementRecord in services/api/src/procurement/index.js).
    // The seeded "Purchase Manager" role itself bundles procurement.po.create
    // with procurement.po.approve, which trips a *blocking* SoD conflict the
    // moment it is granted to anyone (see SOD_CONFLICTS in
    // apps/web/src/lib/access-control.ts) — so it can never actually be
    // invited. Instead we create a narrow custom "approver-only" role (view +
    // qualify + approve, no create/manage permissions) via the real Roles
    // settings UI, then invite a second synthetic account into that role and
    // use it purely for the approve/qualify clicks.
    // -----------------------------------------------------------------
    let approverPage = null;
    try {
      log("role", "Creating a narrow custom 'Procurement Approver (Demo)' role");
      await page.goto(`${BASE_URL}/settings/roles`, { waitUntil: "networkidle" });
      await page.locator('input[name="name"]').fill("Procurement Approver (Demo)");
      await page.locator('input[name="slug"]').fill("procurement_approver_demo");
      await page.locator('select[name="moduleKey"]').selectOption({ label: "Procurement" }).catch(() =>
        page.locator('select[name="moduleKey"]').selectOption("procurement"),
      );
      await page.locator('textarea[name="description"]').fill(
        "Demo-only role: approve/qualify procurement records without create rights, to satisfy segregation-of-duties when seeding marketing demo data.",
      );
      for (const key of [
        "procurement.view",
        "procurement.suppliers.view",
        "procurement.suppliers.qualify",
        "procurement.po.approve",
        "procurement.receipts.approve",
        "workspace.view",
        "notifications.view",
        "profile.manage",
      ]) {
        await page.locator(`input[name="permissionKeys"][value="${key}"]`).check({ force: true }).catch(() => {});
      }
      const { body: roleBody } = await waitForJson(page, "/api/roles", () =>
        page.getByRole("button", { name: "Create role" }).click(),
      );
      if (!roleBody.ok) throw new Error(`Custom role creation failed: ${roleBody.message}`);
      summary.stepsCompleted.push("approver-role");

      log("invite", `Inviting approver ${DEMO_APPROVER.email} as Procurement Approver (Demo)`);
      await page.goto(`${BASE_URL}/settings/users`, { waitUntil: "networkidle" });
      await page.getByLabel("Work email").fill(DEMO_APPROVER.email);
      const approverRoleRow = page.locator("label.checkbox-row").filter({ hasText: "Procurement Approver (Demo)" }).first();
      await approverRoleRow.locator('input[type="checkbox"]').check();
      const { body: inviteBody } = await waitForJson(page, "/api/invitations", () =>
        page.getByRole("button", { name: "Send invitation" }).click(),
      );
      if (!inviteBody.ok || !inviteBody.developmentUrl) {
        throw new Error(`Invitation failed: ${inviteBody.message || "no developmentUrl returned"}`);
      }
      summary.stepsCompleted.push("invite-approver");

      const approverContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      approverPage = await approverContext.newPage();
      approverPage.on("dialog", (dialog) => dialog.accept());
      await approverPage.goto(inviteBody.developmentUrl, { waitUntil: "networkidle" });
      await approverPage.locator('input[name="fullName"]').fill(DEMO_APPROVER.fullName);
      await approverPage.locator('input[name="password"]').fill(DEMO_APPROVER.password);
      await approverPage.locator('input[name="confirmPassword"]').fill(DEMO_APPROVER.password);
      await waitForJson(approverPage, "/api/invitations/accept", () =>
        approverPage.getByRole("button", { name: "Accept invitation" }).click(),
      );
      await approverPage.waitForURL("**/dashboard", { timeout: 15_000 });
      summary.stepsCompleted.push("approver-joined");
    } catch (error) {
      log("invite", `WARNING: could not set up a second approver account: ${error instanceof Error ? error.message : error}`);
      summary.stepsFailed.push(`invite-approver:${error instanceof Error ? error.message : String(error)}`);
    }

    log("supplier", `Creating supplier ${SUPPLIER.displayName}`);
    await page.goto(`${BASE_URL}/procurement/suppliers/new`, { waitUntil: "networkidle" });
    await page.getByLabel("Supplier code").fill(SUPPLIER.supplierCode);
    await page.getByLabel("Legal name").fill(SUPPLIER.legalName);
    await page.getByLabel("Display name").fill(SUPPLIER.displayName);
    await page.getByLabel("Currency").fill(SUPPLIER.currencyCode);
    const { body: supplierBody } = await waitForJson(page, "/api/procurement/resources/suppliers", () =>
      page.getByRole("button", { name: "Create supplier" }).click(),
    );
    if (supplierBody.ok) {
      summary.supplierCreated = true;
      const supplierId = supplierBody.record?.id;
      await page.waitForURL(`**/procurement/suppliers/${supplierId}`, { timeout: 15_000 });
      await runProcurementAction(page, "Submit");
      if (approverPage) {
        await approverPage.goto(`${BASE_URL}/procurement/suppliers/${supplierId}`, { waitUntil: "networkidle" });
        await runProcurementAction(approverPage, "Qualify");
        await runProcurementAction(approverPage, "Activate");
      } else {
        log("supplier", "Skipping qualify/activate: no approver account available.");
      }
      summary.stepsCompleted.push("supplier");

      log("purchase-order", "Creating a restock purchase order");
      await page.goto(`${BASE_URL}/procurement/orders/new`, { waitUntil: "networkidle" });
      // Select the supplier first: its option list loads async and this
      // helper may reload the page if the (just-activated) supplier hasn't
      // shown up yet — reloading after filling other fields would wipe them.
      await selectFirstRealOption(page, page.getByLabel("Supplier"));
      await page.getByLabel("Order title").fill("Restock — Precision Steel Bracket");
      await page.getByLabel("Currency").fill("INR");
      await page.locator(".enterprise-line-row input").nth(0).fill("Precision Steel Bracket — restock");
      await page.locator(".enterprise-line-row input").nth(1).fill("200");
      await page.locator(".enterprise-line-row input").nth(2).fill("310");
      const { body: poBody } = await waitForJson(page, "/api/procurement/resources/purchase-orders", () =>
        page.getByRole("button", { name: "Create purchase order" }).click(),
      );
      if (poBody.ok) {
        summary.purchaseOrderCreated = true;
        const poId = poBody.record?.id;
        await page.waitForURL(`**/procurement/orders/${poId}`, { timeout: 15_000 });
        await runProcurementAction(page, "Submit");
        if (approverPage) {
          await approverPage.goto(`${BASE_URL}/procurement/orders/${poId}`, { waitUntil: "networkidle" });
          await runProcurementAction(approverPage, "Approve");
        } else {
          log("purchase-order", "Skipping approve: no approver account available.");
        }
        await page.goto(`${BASE_URL}/procurement/orders/${poId}`, { waitUntil: "networkidle" });
        await runProcurementAction(page, "Dispatch");
        await runProcurementAction(page, "Acknowledge");
        summary.stepsCompleted.push("purchase-order");

        log("receipt", "Recording a goods receipt against the acknowledged purchase order");
        await page.goto(`${BASE_URL}/procurement/receipts/new`, { waitUntil: "networkidle" });
        await selectFirstRealOption(page, page.getByLabel("Purchase order"));
        await page.getByLabel("Currency").fill("INR");
        await page.locator(".enterprise-line-row input").nth(0).fill("Precision Steel Bracket — received");
        await page.locator(".enterprise-line-row input").nth(1).fill("200");
        await page.locator(".enterprise-line-row input").nth(2).fill("310");
        const { body: receiptBody } = await waitForJson(page, "/api/procurement/resources/receipts", () =>
          page.getByRole("button", { name: "Create receipt" }).click(),
        );
        if (receiptBody.ok) {
          summary.receiptCreated = true;
          const receiptId = receiptBody.record?.id;
          await page.waitForURL(`**/procurement/receipts/${receiptId}`, { timeout: 15_000 });
          await runProcurementAction(page, "Submit");
          if (approverPage) {
            await approverPage.goto(`${BASE_URL}/procurement/receipts/${receiptId}`, { waitUntil: "networkidle" });
            await runProcurementAction(approverPage, "Approve");
          } else {
            log("receipt", "Skipping approve: no approver account available.");
          }
          summary.stepsCompleted.push("receipt");
        } else {
          summary.stepsFailed.push(`receipt:${receiptBody.message}`);
        }
      } else {
        summary.stepsFailed.push(`purchase-order:${poBody.message}`);
      }
    } else {
      summary.stepsFailed.push(`supplier:${supplierBody.message}`);
    }

    // -----------------------------------------------------------------
    // Step 5: sanity visits to Stock and Accounting so the capture script
    // knows whether those views are worth screenshotting.
    // -----------------------------------------------------------------
    await page.goto(`${BASE_URL}/stock`, { waitUntil: "networkidle" });
    await page.goto(`${BASE_URL}/accounting`, { waitUntil: "networkidle" });
    summary.stepsCompleted.push("final-sanity-visits");

    console.log("\n[seed] DONE. Summary:\n", JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error("[seed] FATAL:", error);
    summary.stepsFailed.push(`fatal:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
    await browser.close();
  }

  const credentialsPath = path.join(__dirname, ".demo-org-credentials.local.md");
  await writeFile(
    credentialsPath,
    `# Demo org credentials (local only — never commit)\n\n` +
      `- Email: ${DEMO_USER.email}\n` +
      `- Password: ${DEMO_USER.password}\n` +
      `- Organization name: ${DEMO_ORG.organizationName}\n` +
      `- Quotation id: ${summary.quotationId || "n/a"}\n` +
      `- Sales order id: ${summary.orderId || "n/a"}\n` +
      `- Generated: ${new Date().toISOString()}\n`,
  );
  log("done", `Credentials written to ${credentialsPath} (gitignored).`);
  log("done", `Steps completed: ${summary.stepsCompleted.join(", ")}`);
  if (summary.stepsFailed.length) {
    log("done", `Steps with issues: ${summary.stepsFailed.join(", ")}`);
  }
}

main().catch((error) => {
  console.error("[seed] Unhandled error:", error);
  process.exitCode = 1;
});
