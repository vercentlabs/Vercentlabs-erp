import { test, expect } from "@playwright/test";
import { fixtures } from "./fixtures";

test("opportunity stage can be moved via the Pipeline tab", async ({ page }) => {
  const apiErrors: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 500) {
      apiErrors.push(`${res.status()} on ${res.url()}`);
    }
  });

  await page.goto(`/crm/opportunities/${fixtures.opportunityId}`, { waitUntil: "networkidle" });
  const currentStage = (await page.getByText("Stage", { exact: true }).locator("..").innerText()).replace("Stage", "").trim();

  await page.getByRole("tab", { name: "Pipeline" }).click();
  await page.getByRole("button", { name: /Destination stage/i }).click();

  const listbox = page.getByRole("listbox", { name: /Destination stage/i });
  await expect(listbox).toBeVisible();
  const optionLabels = await listbox.getByRole("option").allInnerTexts();

  // Avoid the current stage and Won/Lost, which require an outcome reason —
  // keep this a plain, deterministic open-to-open transition.
  const target = optionLabels.find((label) => label !== currentStage && !/won|lost/i.test(label));
  test.skip(!target, "No eligible open destination stage found for this fixture");

  await listbox.getByRole("option", { name: target! }).click();

  const moveButton = page.getByRole("button", { name: "Move" });
  await expect(moveButton).toBeEnabled();

  const [stageResponse] = await Promise.all([
    page.waitForResponse((res) => res.url().includes("/stage") && res.request().method() === "POST"),
    moveButton.click(),
  ]);

  expect(stageResponse.status(), await stageResponse.text().catch(() => "")).toBeLessThan(300);
  expect(apiErrors, apiErrors.join(" | ")).toEqual([]);

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Stage", { exact: true }).locator("..")).toContainText(target!);
});
