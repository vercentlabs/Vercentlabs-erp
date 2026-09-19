import { test, expect } from "@playwright/test";
import { Client } from "pg";
import fs from "node:fs";
import path from "node:path";

// Real-browser, real-database proof of SP008 (role creation/editing) end
// to end, against the ACTUAL /settings/roles screen and its real backend
// (createRole/updateRole, services/api/src/core/access-administration.js)
// -- not a mock, not a screenshot. Uses the already-authenticated e2e
// owner session (see auth.setup.ts) rather than provisioning a fresh user,
// since this screen's own backend already has exhaustive adversarial
// coverage (access-administration-sp008.test.mjs) -- this spec's job is
// specifically to prove the real UI reaches that real backend and the
// change is genuinely persisted, which no database-only test can show.

function loadDbUrlFromEnvLocal(): string | undefined {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  const filePath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(filePath)) return undefined;
  const match = fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .find((line) => line.startsWith("MIGRATION_DATABASE_URL="));
  return match?.slice("MIGRATION_DATABASE_URL=".length).trim();
}

async function dbClient() {
  const client = new Client({ connectionString: loadDbUrlFromEnvLocal() });
  await client.connect();
  return client;
}

test("SP008 end-to-end: create a custom role through the real /settings/roles screen, edit it, and confirm it is genuinely persisted", async ({ page }) => {
  const db = await dbClient();
  const roleName = `E2E Role ${Date.now()}`;
  let roleId: string | undefined;

  try {
    await page.goto("/settings/roles", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Roles and permissions" })).toBeVisible();

    // --- Create ---
    await page.getByRole("button", { name: "New role" }).click();
    await page.getByLabel("Role name").fill(roleName);
    // Expand one permission category and select a single, low-impact
    // permission -- workspace.view -- so the role is real but harmless.
    await page.getByText(/^Workspace \(/).click();
    const workspaceViewCheckbox = page.getByRole("checkbox", { name: "View workspace" });
    // The permission list lives in the Dialog's own overflow-y-auto
    // container, well below the default 720px test viewport -- Playwright
    // refuses even a forced mouse click outside the actual viewport
    // bounds, so dispatch a real DOM click directly instead of routing it
    // through mouse coordinates.
    await workspaceViewCheckbox.evaluate((el: HTMLElement) => {
      el.scrollIntoView({ block: "center" });
      el.click();
    });
    await expect(workspaceViewCheckbox).toBeChecked();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/settings/roles") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Save role" }).click(),
    ]);
    await expect(page.getByText(roleName)).toBeVisible({ timeout: 10_000 });

    // Confirm real persistence in the database, not just optimistic UI state.
    const created = await db.query(`SELECT id, is_system FROM roles WHERE name = $1`, [roleName]);
    expect(created.rows.length).toBe(1);
    expect(created.rows[0].is_system).toBe(false);
    roleId = created.rows[0].id;

    // --- Edit ---
    const roleRow = page.locator("li", { hasText: roleName });
    await roleRow.getByRole("button", { name: "Edit" }).click();
    const updatedName = `${roleName} (Updated)`;
    await page.getByLabel("Role name").fill(updatedName);
    await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/api/settings/roles/${roleId}`) && res.request().method() === "PUT"),
      page.getByRole("button", { name: "Save role" }).click(),
    ]);
    await expect(page.getByText(updatedName)).toBeVisible({ timeout: 10_000 });

    const updated = await db.query(`SELECT name, version FROM roles WHERE id = $1`, [roleId]);
    expect(updated.rows[0].name).toBe(updatedName);
    expect(updated.rows[0].version).toBe(2);

    // --- Remove ---
    await roleRow.getByRole("button", { name: "Remove" }).click();
    await Promise.all([
      page.waitForResponse((res) => res.url().includes(`/api/settings/roles/${roleId}`) && res.request().method() === "DELETE"),
      page.getByRole("button", { name: "Remove", exact: true }).last().click(),
    ]);
    await expect(page.getByText(updatedName)).not.toBeVisible({ timeout: 10_000 });

    const archived = await db.query(`SELECT status FROM roles WHERE id = $1`, [roleId]);
    expect(archived.rows[0].status).toBe("inactive");
  } finally {
    if (roleId) {
      await db.query(`DELETE FROM role_version_snapshots WHERE role_id=$1`, [roleId]).catch(() => undefined);
      await db.query(`DELETE FROM role_permissions WHERE role_id=$1`, [roleId]).catch(() => undefined);
      await db.query(`DELETE FROM audit_events WHERE entity_type='role' AND entity_id=$1`, [roleId]).catch(() => undefined);
      await db.query(`DELETE FROM roles WHERE id=$1`, [roleId]).catch(() => undefined);
    }
    await db.end();
  }
});
