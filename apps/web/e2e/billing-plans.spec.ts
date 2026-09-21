import { randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";
import { Client } from "pg";

import { open } from "./accounting-fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import { openSalesSession } from "./sales-fixtures";

// The billing page as a real organisation owner on the Free plan: what they have, what Standard costs per
// additional user, that the third plan is visible but cannot be bought, and that someone without billing.view is
// refused. Checkout itself is not driven here (it needs a live payment provider); its domain paths, signature
// verification and webhooks are covered by tests/integration/billing-seats.test.mjs against real PostgreSQL.

test("Free plan owner sees users, Standard pricing per additional user, and a coming-soon third plan", async ({ browser }) => {
  test.setTimeout(240_000);
  const db = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await db.connect();
  const { registerOrganization } = await import("../../../services/api/src/core/organization-registration.js");
  const password = "BillingE2E!2026Secure";
  const suffix = randomUUID().slice(0, 8);
  const email = `billing-owner-${suffix}@crm-e2e-fixture.test`;
  let organizationId = "";
  try {
    const registered = await registerOrganization(db, { fullName: "Billing Owner", email, password, organizationName: `Billing Org ${suffix}`, countryCode: "IN", baseCurrency: "INR", timezone: "Asia/Kolkata" });
    organizationId = registered.organizationId;
    await db.query(`UPDATE users SET email_verified_at = now() WHERE id = $1`, [registered.userId]);

    const owner = await openSalesSession(browser, { email, password, userId: registered.userId });
    const page = owner.page;
    await open(page, "/settings/billing", "Billing");

    // Current plan: Free, 1 of 3 users, no charge
    await expect(page.getByTestId("current-plan-name")).toHaveText("Free", { timeout: 60_000 });
    await expect(page.getByTestId("seat-usage")).toHaveText("1 of 3");

    // Standard: Rs 1,000 per additional user; 3 users included
    const standard = page.getByTestId("plan-standard");
    await expect(standard).toContainText("₹1,000");
    await expect(standard).toContainText("First 3 users included");
    await standard.getByRole("textbox", { name: "Total users" }).fill("10");
    await standard.getByRole("textbox", { name: "Total users" }).blur();
    await expect(standard.getByTestId("price-total")).toHaveText("₹7,000 / month");
    await standard.getByRole("textbox", { name: "Total users" }).fill("3");
    await standard.getByRole("textbox", { name: "Total users" }).blur();
    await expect(standard.getByTestId("price-quote")).toContainText("Up to 3 users is free");

    // Online payment is not switched on in this environment: the upgrade is refused up front, not attempted
    await expect(standard.getByRole("button", { name: /Upgrade to Standard/ })).toBeDisabled();

    // The third plan is visible and cannot be chosen
    const third = page.getByTestId("plan-enterprise");
    await expect(third).toContainText("Coming soon");
    await expect(third.getByRole("button", { name: "Coming soon" })).toBeDisabled();

    // Billing details validate GSTIN
    await page.getByLabel("Legal name").fill("Billing Org Pvt Ltd");
    await page.getByLabel("Billing email").fill(email);
    await page.getByLabel("GSTIN").fill("NOTAGSTIN");
    await page.getByRole("button", { name: "Save billing details" }).click();
    await expect(page.getByText(/GSTIN is not valid/i)).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("GSTIN").fill("27AAPFU0939F1ZV");
    await page.getByRole("button", { name: "Save billing details" }).click();
    await expect(page.getByText("Billing details saved.")).toBeVisible({ timeout: 30_000 });

    // A member without billing.view is refused
    const memberId = randomUUID();
    const memberEmail = `billing-member-${suffix}@crm-e2e-fixture.test`;
    const { hashPassword } = await import("../../../services/api/src/core/session.js");
    await db.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'Plain Member',$3,'active',now())`, [memberId, memberEmail, await hashPassword(password)]);
    await db.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, memberId]);
    const employeeRole = (await db.query(`SELECT id FROM roles WHERE organization_id=$1 AND slug='employee'`, [organizationId])).rows[0];
    await db.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, memberId, employeeRole.id]);
    const member = await openSalesSession(browser, { email: memberEmail, password, userId: memberId });
    await member.page.goto("/settings/billing", { waitUntil: "domcontentloaded" });
    await expect(member.page.getByText(/don't have access to Billing/i)).toBeVisible({ timeout: 120_000 });
    await member.context.close();
    await owner.context.close();
  } finally {
    if (organizationId) await db.query(`DELETE FROM organizations WHERE id = $1`, [organizationId]).catch(() => undefined);
    await db.end();
  }
});
