import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

import { createRazorpayProvider, runBillingMaintenance } from "../../../services/api/src/core/billing/index.js";
import { BILLING_E2E_ENV } from "../playwright.config.billing";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession } from "./sales-fixtures";

// SaaS billing in a real browser, real database and the real Razorpay adapter
// pointed at the local stand-in. The Razorpay Checkout script is replaced by a
// stand-in that "pays" through the stand-in's control API and returns a
// genuinely signed response, so the server-side verification is real.
// Worker maintenance is run in-process where a journey needs it.

test.describe.configure({ mode: "serial" });

const STANDIN = BILLING_E2E_ENV.STANDIN_URL;
const control = async (path: string, body: unknown) => {
  const response = await fetch(`${STANDIN}/__control/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
};

const FAKE_CHECKOUT = `
  window.Razorpay = function (options) { this.options = options; this.handlers = {}; };
  window.Razorpay.prototype.on = function (event, handler) { this.handlers[event] = handler; };
  window.Razorpay.prototype.open = function () {
    var self = this;
    window.__standinCheckout(self.options.subscription_id).then(function (result) {
      if (result.mode === "pay") self.options.handler(result.response);
      else if (result.mode === "decline") self.handlers["payment.failed"]({ error: { description: "Card declined by the bank." } });
      else self.options.modal.ondismiss();
    });
  };`;

async function installCheckoutStandIn(page: Page, mode: () => "pay" | "decline" | "close") {
  await page.route("https://checkout.razorpay.com/v1/checkout.js", (route) => route.fulfill({ contentType: "application/javascript", body: FAKE_CHECKOUT }));
  await page.exposeFunction("__standinCheckout", async (subscriptionId: string) => {
    const chosen = mode();
    if (chosen !== "pay") return { mode: chosen };
    return { mode: "pay", response: await control("authenticate", { subscriptionId, status: "active" }) };
  });
}

let db: pg.Client;
let pool: pg.Pool;
const organizations: string[] = [];
const provider = createRazorpayProvider({ ...BILLING_E2E_ENV, BILLING_CHECKOUT_ENABLED: "true" });

test.beforeAll(async () => {
  db = new pg.Client({ connectionString: MIGRATION_DATABASE_URL });
  await db.connect();
  pool = new pg.Pool({ connectionString: MIGRATION_DATABASE_URL, max: 2 });
  // Provider plans are permanent: tell the fresh stand-in about already-linked ones.
  const linked = (await db.query(`SELECT provider_plan_id FROM billing_plan_prices WHERE provider_plan_id IS NOT NULL`)).rows;
  await control("plans", { ids: linked.map((row) => row.provider_plan_id) });
});

test.afterAll(async () => {
  if (organizations.length) await db.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [organizations]).catch(() => undefined);
  await pool?.end();
  await db?.end();
});

async function freeOwner(browser: Parameters<typeof openSalesSession>[0], members = 1) {
  const { registerOrganization } = await import("../../../services/api/src/core/organization-registration.js");
  const suffix = randomUUID().slice(0, 8);
  const email = `billing-e2e-${suffix}@crm-e2e-fixture.test`;
  const password = "BillingE2E!2026Secure";
  const registered = await registerOrganization(db, { fullName: "Billing Owner", email, password, organizationName: `Billing E2E ${suffix}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata" });
  organizations.push(registered.organizationId);
  await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [registered.userId]);
  for (let i = 1; i < members; i += 1) {
    const id = randomUUID();
    await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Member','x','active',now())`, [id, `m${i}-${suffix}@crm-e2e-fixture.test`]);
    await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [registered.organizationId, id]);
  }
  const session = await openSalesSession(browser, { email, password, userId: registered.userId });
  return { ...session, organizationId: registered.organizationId, email, password, suffix };
}

const maintenance = (steps: Array<"webhooks" | "checkouts" | "seats" | "cancellations" | "reconciliation">) =>
  runBillingMaintenance({ connect: () => pool.connect(), provider, workerId: "e2e", batchSize: 50, leaseSeconds: 60, steps });

async function openBilling(page: Page) {
  await page.goto("/settings/billing", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("current-plan-name")).toBeVisible({ timeout: 180_000 });
}

async function setUsers(page: Page, users: number) {
  const field = page.getByTestId("plan-standard").getByRole("textbox", { name: "Total users" });
  await field.fill(String(users));
  await field.blur();
}

test("Free owner upgrades to Standard, sees payments, schedules a reduction and cancels at renewal", async ({ browser }) => {
  const owner = await freeOwner(browser, 2);
  const page = owner.page;
  let checkoutMode: "pay" | "decline" | "close" = "close";
  await installCheckoutStandIn(page, () => checkoutMode);
  await openBilling(page);

  // Free: 1 user included; this organisation already has 2, so it is over its plan.
  await expect(page.getByTestId("current-plan-name")).toHaveText("Free");
  await expect(page.getByTestId("seat-usage")).toHaveText("2 of 1");
  await expect(page.getByTestId("overage-notice")).toBeVisible();
  await expect(page.getByTestId("plan-enterprise")).toContainText("Custom pricing");
  await expect(page.getByTestId("plan-enterprise").getByRole("button")).toHaveCount(0);

  // Exact server-side prices shown before checkout.
  await setUsers(page, 2);
  await expect(page.getByTestId("price-total")).toHaveText("₹1,000 / month");
  await setUsers(page, 5);
  await expect(page.getByTestId("price-total")).toHaveText("₹4,000 / month");
  await setUsers(page, 10);
  await expect(page.getByTestId("price-total")).toHaveText("₹9,000 / month");

  // Closing the window never claims "not charged".
  await setUsers(page, 3);
  await page.getByRole("button", { name: "Upgrade to Standard" }).click();
  await expect(page.getByTestId("billing-report")).toContainText("Checkout did not complete in this window");
  await expect(page.getByTestId("billing-report")).not.toContainText(/not (been )?charged/i);

  // Paying: signed callback -> server verifies with the provider -> Standard.
  checkoutMode = "pay";
  await page.getByRole("button", { name: "Upgrade to Standard" }).click();
  await expect(page.getByTestId("billing-report")).toHaveText("Standard is active. Thank you.");
  await expect(page.getByTestId("current-plan-name")).toHaveText("Standard");
  await expect(page.getByTestId("seat-usage")).toHaveText("2 of 3");
  await expect(page.getByTestId("monthly-amount")).toHaveText("₹2,000");
  await expect(page.getByTestId("overage-notice")).toHaveCount(0);

  // The renewal charge arrives as a signed webhook through the real endpoint; the worker applies it.
  const sub = (await db.query(`SELECT provider_subscription_id FROM organization_subscriptions WHERE organization_id=$1`, [owner.organizationId])).rows[0].provider_subscription_id;
  const invoiceId = `inv_${randomUUID().slice(0, 10)}`;
  const signed = await control("webhook", {
    event: "subscription.charged",
    subscriptionId: sub,
    extras: {
      payment: { entity: { id: `pay_${randomUUID().slice(0, 10)}`, amount: 200000, currency: "INR", status: "captured", method: "upi", invoice_id: invoiceId, created_at: Math.floor(Date.now() / 1000) } },
      invoice: { entity: { id: invoiceId, subscription_id: sub, amount: 200000, amount_paid: 200000, status: "paid", short_url: "https://rzp.io/i/e2e", issued_at: Math.floor(Date.now() / 1000) } },
    },
  });
  const delivered = await page.request.post("/api/billing/webhook", {
    data: signed.body,
    headers: { "content-type": "application/json", "x-razorpay-signature": signed.signature, "x-razorpay-event-id": signed.eventId },
  });
  expect(delivered.status()).toBe(200);
  await maintenance(["webhooks"]);
  await page.reload();
  const payments = page.getByTestId("billing-payments");
  await expect(payments).toContainText("₹2,000");
  await expect(payments).toContainText("Paid");
  await expect(payments).toContainText("UPI");
  await expect(page.getByTestId("billing-invoices").getByRole("link", { name: "View provider invoice" })).toBeVisible();
  await expect(page.getByText(/GST invoice/i)).toHaveCount(0);

  // Schedule a reduction back to 2 users at renewal.
  await setUsers(page, 2);
  await page.getByRole("button", { name: "Update users" }).click();
  await expect(page.getByTestId("billing-report")).toContainText("reduce to 2 at the next renewal");
  await expect(page.getByText("Until then you keep what you have paid for.")).toBeVisible();

  // Cancel at renewal: clear confirmation, no refund promise.
  await page.getByRole("button", { name: "Cancel subscription" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("moves to the Free plan");
  await expect(dialog).toContainText("No refund is issued");
  await dialog.getByRole("button", { name: "Cancel at renewal" }).click();
  await expect(page.getByTestId("billing-state")).toContainText("Cancels at renewal");
  await owner.context.close();
});

test("verification pending is shown honestly and completed by the worker; a failed renewal shows payment overdue", async ({ browser }) => {
  const owner = await freeOwner(browser, 1);
  const page = owner.page;
  await installCheckoutStandIn(page, () => "pay");
  await openBilling(page);
  await setUsers(page, 2);
  // The provider cannot be reached while the server verifies the payment.
  await control("fail", { method: "GET", pattern: "/subscriptions/sub_", mode: "status", status: 503 });
  await page.getByRole("button", { name: "Upgrade to Standard" }).click();
  await expect(page.getByTestId("billing-report")).toContainText("Verifying your payment");
  await expect(page.getByTestId("verifying-notice")).toBeVisible();
  await expect(page.getByTestId("billing-state")).toContainText("Verifying payment");
  await expect(page.getByTestId("current-plan-name")).toHaveText("Free");

  // The worker finishes verification; the page updates by itself.
  await db.query(`UPDATE billing_checkout_sessions SET next_recovery_at = now() - interval '1 second' WHERE organization_id=$1 AND status='verifying'`, [owner.organizationId]);
  await maintenance(["checkouts"]);
  await expect(page.getByTestId("current-plan-name")).toHaveText("Standard", { timeout: 30_000 });

  // A failed renewal: provider moves to pending; the webhook is applied by the worker.
  const sub = (await db.query(`SELECT provider_subscription_id FROM organization_subscriptions WHERE organization_id=$1`, [owner.organizationId])).rows[0].provider_subscription_id;
  await control("status", { subscriptionId: sub, status: "pending" });
  const signed = await control("webhook", { event: "subscription.pending", subscriptionId: sub });
  expect((await page.request.post("/api/billing/webhook", { data: signed.body, headers: { "content-type": "application/json", "x-razorpay-signature": signed.signature, "x-razorpay-event-id": signed.eventId } })).status()).toBe(200);
  await maintenance(["webhooks"]);
  await page.reload();
  await expect(page.getByTestId("billing-state")).toContainText("Payment overdue");
  await expect(page.getByTestId("past-due-notice")).toBeVisible();

  // A forged webhook is refused at the edge.
  const forged = await page.request.post("/api/billing/webhook", { data: signed.body, headers: { "content-type": "application/json", "x-razorpay-signature": "0".repeat(64) } });
  expect(forged.status()).toBe(401);

  // Billing profile validation (GSTIN optional but validated) and someone without billing.view is refused.
  await page.getByLabel("Legal name").fill("Billing E2E Pvt Ltd");
  await page.getByLabel("Billing email").fill(owner.email);
  await page.getByRole("textbox", { name: /^Address\s*\*?$/ }).fill("1 MG Road");
  await page.getByLabel("City").fill("Pune");
  await page.getByLabel("State").fill("Maharashtra");
  await page.getByLabel("Postal code").fill("411001");
  await page.getByLabel("GSTIN").fill("NOTAGSTIN");
  await page.getByRole("button", { name: "Save billing details" }).click();
  await expect(page.getByTestId("billing-report")).toContainText("GSTIN is not valid");
  await page.getByLabel("GSTIN").fill("27AAPFU0939F1ZV");
  await page.getByRole("button", { name: "Save billing details" }).click();
  await expect(page.getByTestId("billing-report")).toHaveText("Billing details saved.");

  const memberId = randomUUID();
  const memberEmail = `billing-member-${owner.suffix}@crm-e2e-fixture.test`;
  const { hashPassword } = await import("../../../services/api/src/core/session.js");
  await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Plain Member',$3,'active',now())`, [memberId, memberEmail, await hashPassword(owner.password)]);
  await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [owner.organizationId, memberId]);
  const employee = (await db.query(`SELECT id FROM roles WHERE organization_id=$1 AND slug='employee'`, [owner.organizationId])).rows[0];
  await db.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [owner.organizationId, memberId, employee.id]);
  const member = await openSalesSession(browser, { email: memberEmail, password: owner.password, userId: memberId });
  await member.page.goto("/settings/billing", { waitUntil: "domcontentloaded" });
  await expect(member.page.getByText(/don't have access to Billing/i)).toBeVisible({ timeout: 120_000 });
  expect((await member.page.request.get("/api/billing/summary")).status()).toBe(403);
  await member.context.close();
  await owner.context.close();
});
