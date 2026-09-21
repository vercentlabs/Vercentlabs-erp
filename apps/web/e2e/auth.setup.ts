import { test as setup } from "@playwright/test";
import { fixtures } from "./fixtures";

setup("authenticate as e2e owner", async ({ page }) => {
  // After a code change the first page hit compiles in the development server, which can take longer than the default 45 seconds.
  setup.setTimeout(240_000);
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(fixtures.ownerEmail);
  await page.getByLabel(/password/i).fill(fixtures.ownerPassword);
  await Promise.all([
    page.waitForResponse((res) => res.url().includes("/api/auth/login")),
    page.getByRole("button", { name: /sign in|log in/i }).click(),
  ]);
  await page.goto("/crm", { waitUntil: "networkidle" });
  await page.context().storageState({ path: "e2e/.auth/owner.json" });
});
