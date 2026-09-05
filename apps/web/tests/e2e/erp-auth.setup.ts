import { expect, test as setup } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const authFile = path.resolve("test-results/erp-auth.json");

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for the authenticated ERP browser gate. ` +
        "Use a dedicated non-production E2E account with access to the representative fixtures.",
    );
  }
  return value;
}

setup("authenticate ERP fixture user", async ({ page }) => {
  const email = required("ERP_E2E_EMAIL");
  const password = required("ERP_E2E_PASSWORD");

  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);

  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  fs.mkdirSync(path.dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
