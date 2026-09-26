import { test, expect } from "@playwright/test";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";

// Real-browser, real-database proof of journeys #5/#6 ("Company creation
// and editing", "Branch creation and editing") through the actual
// /settings/companies and /settings/branches screens and their real
// backend (createCompany/updateCompany/createBranch/updateBranch,
// services/api/src/core/organization/administration.js).

function loadDbUrlFromEnvLocal(): string | undefined {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  const filePath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(filePath)) return undefined;
  const match = fs.readFileSync(filePath, "utf8").split("\n").find((line) => line.startsWith("MIGRATION_DATABASE_URL="));
  return match?.slice("MIGRATION_DATABASE_URL=".length).trim();
}

async function dbClient() {
  const client = new Client({ connectionString: loadDbUrlFromEnvLocal() });
  await client.connect();
  return client;
}

test("journeys #5/#6: create and edit a company, then create and edit a branch, through the real Settings screens", async ({ page }) => {
  const db = await dbClient();
  const suffix = Date.now().toString().slice(-8);
  const companyCode = `E2E${suffix}`.slice(0, 10).toUpperCase();
  let companyId: string | undefined;
  let branchId: string | undefined;

  try {
    // --- Company: create ---
    await page.goto("/settings/companies", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New company" }).click();
    await page.getByLabel("Company name").fill(`E2E Company ${suffix}`);
    await page.getByLabel("Legal name").fill(`E2E Company ${suffix} Pvt Ltd`);
    await page.getByLabel("Company code").fill(companyCode);
    await page.getByLabel("Country code").fill("IN");
    await page.getByLabel("Base currency").fill("INR");
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/settings/companies") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Create company" }).click(),
    ]);
    await expect(page.getByText(`E2E Company ${suffix}`, { exact: true })).toBeVisible({ timeout: 10_000 });

    const createdCompany = await db.query(`SELECT id FROM companies WHERE code = $1`, [companyCode]);
    expect(createdCompany.rows.length).toBe(1);
    companyId = createdCompany.rows[0].id;

    // --- Company: edit ---
    const companyRow = page.locator("li", { hasText: `E2E Company ${suffix}` });
    await companyRow.getByRole("button", { name: "Edit" }).click();
    const updatedCompanyName = `E2E Company ${suffix} (Updated)`;
    await page.getByLabel("Company name").fill(updatedCompanyName);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/api/settings/companies/${companyId}`) && res.request().method() === "PUT"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    await expect(page.getByText(updatedCompanyName)).toBeVisible({ timeout: 10_000 });
    const updatedCompany = await db.query(`SELECT name FROM companies WHERE id = $1`, [companyId]);
    expect(updatedCompany.rows[0].name).toBe(updatedCompanyName);

    // --- Branch: create (against the company just created) ---
    await page.goto("/settings/branches", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "New branch" }).click();
    await page.getByLabel("Branch name").fill(`E2E Branch ${suffix}`);
    await page.getByLabel("Branch code").fill(`BR${suffix}`.slice(0, 10).toUpperCase());
    await page.getByLabel("Timezone").fill("Asia/Kolkata");
    const companySelect = page.getByRole("dialog").getByRole("button", { name: /company/i });
    await companySelect.click();
    await page.getByRole("option", { name: updatedCompanyName }).click();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/settings/branches") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Create branch" }).click(),
    ]);
    await expect(page.getByText(`E2E Branch ${suffix}`, { exact: true })).toBeVisible({ timeout: 10_000 });

    const createdBranch = await db.query(`SELECT id, company_id FROM branches WHERE organization_id = (SELECT organization_id FROM companies WHERE id=$1) AND name = $2`, [
      companyId,
      `E2E Branch ${suffix}`,
    ]);
    expect(createdBranch.rows.length).toBe(1);
    expect(createdBranch.rows[0].company_id).toBe(companyId);
    branchId = createdBranch.rows[0].id;

    // --- Branch: edit ---
    const branchRow = page.locator("li", { hasText: `E2E Branch ${suffix}` });
    await branchRow.getByRole("button", { name: "Edit" }).click();
    const updatedBranchName = `E2E Branch ${suffix} (Updated)`;
    await page.getByLabel("Branch name").fill(updatedBranchName);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/api/settings/branches/${branchId}`) && res.request().method() === "PUT"),
      page.getByRole("button", { name: "Save" }).click(),
    ]);
    await expect(page.getByText(updatedBranchName)).toBeVisible({ timeout: 10_000 });
    const updatedBranch = await db.query(`SELECT name FROM branches WHERE id = $1`, [branchId]);
    expect(updatedBranch.rows[0].name).toBe(updatedBranchName);
  } finally {
    if (branchId) await db.query(`DELETE FROM branches WHERE id=$1`, [branchId]).catch(() => undefined);
    if (companyId) await db.query(`DELETE FROM companies WHERE id=$1`, [companyId]).catch(() => undefined);
    await db.end();
  }
});
