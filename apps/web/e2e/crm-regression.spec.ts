import { test, expect } from "@playwright/test";
import { fixtures } from "./fixtures";

/**
 * Regression guard for the three P0/P1 defects fixed in this engagement:
 *  - RLS tenant context never set on CRM read routes (commit 0b1fb9f9)
 *  - Postgres parameter type inference 500s on Communications/Notes/Timeline (commit 8529a549)
 *  - Opportunity list/360 showing "Stage —"/"Account —" for real relations (commit 8e201708)
 */

const listRoutes = [
  "/crm/leads",
  "/crm/accounts",
  "/crm/contacts",
  "/crm/opportunities",
  "/crm/pipeline",
];

for (const route of listRoutes) {
  test(`${route} loads with no console errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(err.message));

    const response = await page.goto(route, { waitUntil: "networkidle" });
    expect(response?.status(), `${route} should not 5xx`).toBeLessThan(500);
    expect(errors, `console errors on ${route}: ${errors.join(" | ")}`).toEqual([]);
  });
}

test("opportunity 360 header shows real Stage value", async ({ page }) => {
  // stage_id is NOT NULL by schema, so every opportunity has a real stage —
  // this is what commit 8e201708 fixed regressing to "Stage —".
  await page.goto(`/crm/opportunities/${fixtures.opportunityId}`, { waitUntil: "networkidle" });
  const stageField = page.getByText("Stage", { exact: true }).locator("..");
  await expect(stageField).not.toHaveText(/—$/);
});

test("opportunity 360 header shows real Account value when a party relation exists", async ({ page, request }) => {
  // party_id is nullable, so find a list row that actually has one rather than
  // assuming any single fixture does.
  const listResp = await request.get("/api/crm/opportunities?offset=0", {
    headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") },
  });
  const { rows } = await listResp.json();
  const withParty = (rows as Array<{ id: string; partyName: string | null }>).find((r) => r.partyName);
  test.skip(!withParty, "No opportunity with a party relation found on the first page of results");

  await page.goto(`/crm/opportunities/${withParty!.id}`, { waitUntil: "networkidle" });
  const accountField = page.getByText("Account", { exact: true }).locator("..");
  await expect(accountField).not.toHaveText(/—$/);
  await expect(accountField).toContainText(withParty!.partyName!);
});

test("opportunity 360 Activity tab (communications/notes/timeline) loads without 500", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) {
      errors.push(`${res.status()} on ${res.url()}`);
    }
  });

  await page.goto(`/crm/opportunities/${fixtures.opportunityId}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Activity" }).click();
  await page.waitForLoadState("networkidle");

  expect(errors, `errors on Activity tab: ${errors.join(" | ")}`).toEqual([]);
});

test("opportunity 360 Notes tab loads without 500", async ({ page }) => {
  const errors: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) {
      errors.push(`${res.status()} on ${res.url()}`);
    }
  });

  await page.goto(`/crm/opportunities/${fixtures.opportunityId}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Notes" }).click();
  await page.waitForLoadState("networkidle");

  expect(errors, `errors on Notes tab: ${errors.join(" | ")}`).toEqual([]);
});
