import { test, expect } from "@playwright/test";

import { open } from "./accounting-fixtures";
import { pick } from "./hr-fixtures";
import { getProjectsWorld } from "./projects-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// A project lifecycle as real people with the REAL seeded project_manager role: one manager creates and plans a
// project, cannot approve their own, a second approves, the first starts it, adds a task, logs time and submits
// the week, and the second approves the timesheet. A person with no project permissions is refused. The domain
// rules in depth are covered by the projects-*.test.mjs integration suites against real PostgreSQL.

test("create, approve by someone else, start, plan, log time and approve it", async ({ browser }) => {
  test.setTimeout(300_000);
  const world = await getProjectsWorld();
  const a = await openSession(browser, world.mgrA);
  const b = await openSession(browser, world.mgrB);
  const plain = await openSession(browser, world.plain);
  try {
    const name = `E2E Rollout ${world.suffix}`;
    const task = `E2E Task ${world.suffix}`;
    const pa = a.page;
    const pb = b.page;

    // --- F193: create (a draft), then plan it
    await open(pa, "/projects/all", "Projects");
    await pa.getByRole("button", { name: "New project" }).click();
    let dlg = pa.getByRole("dialog");
    await dlg.getByLabel("Name").first().fill(name);
    await pick(pa, dlg.getByRole("button", { name: /Select type/i }), /Internal/);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(pa.getByRole("row", { name: new RegExp(`${name}.*Draft`) })).toBeVisible({ timeout: 60_000 });
    await pa.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Plan" }).click();
    await expect(pa.getByRole("row", { name: new RegExp(`${name}.*Planned`) })).toBeVisible({ timeout: 60_000 });

    // --- F195: the creator cannot approve their own project
    await pa.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Approve" }).click();
    await expect(pa.getByText(/cannot approve it/i).first()).toBeVisible({ timeout: 60_000 });

    // --- a different manager approves; the creator then starts it
    await open(pb, "/projects/all", "Projects");
    await pb.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Approve" }).click();
    await expect(pb.getByText(/Approved\./).first()).toBeVisible({ timeout: 60_000 });
    await open(pa, "/projects/all", "Projects");
    await pa.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: "Start" }).click();
    await expect(pa.getByRole("row", { name: new RegExp(`${name}.*Active`) })).toBeVisible({ timeout: 60_000 });

    // --- F197: a task
    await open(pa, "/projects/tasks", "Tasks");
    await pa.getByRole("button", { name: "New task" }).click();
    dlg = pa.getByRole("dialog");
    await pick(pa, dlg.getByRole("button", { name: /Select project/i }), new RegExp(name));
    await dlg.getByLabel("Name").first().fill(task);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(pa.getByRole("row", { name: new RegExp(task) })).toBeVisible({ timeout: 60_000 });

    // --- F207: the WBS view of the workspace shows the task
    await open(pa, "/projects/workspace", "Project workspace");
    await pick(pa, pa.getByRole("button", { name: /Select… Project/ }), new RegExp(name));
    await pick(pa, pa.getByRole("button", { name: /Overview View/ }), /Work breakdown/);
    await expect(pa.getByText(task).first()).toBeVisible({ timeout: 60_000 });

    // --- F209: log time yesterday, submit the week
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await open(pa, "/projects/time", "Time entries");
    await pa.getByRole("button", { name: "Log time" }).click();
    dlg = pa.getByRole("dialog");
    await pick(pa, dlg.getByRole("button", { name: /Select project/i }), new RegExp(name));
    await dlg.getByLabel("Date").fill(yesterday);
    await dlg.getByRole("textbox", { name: "Hours" }).fill("3");
    await dlg.getByRole("button", { name: "Save" }).click();
    const timeRow = pa.getByRole("row", { name: /Draft/ }).first();
    await expect(timeRow).toBeVisible({ timeout: 60_000 });
    await timeRow.getByRole("button", { name: "Submit week" }).click();
    await expect(pa.getByText(/Week submitted/).first()).toBeVisible({ timeout: 60_000 });

    // --- F210: the other manager approves the timesheet
    await open(pb, "/projects/timesheets", "Timesheets");
    await pb.getByRole("row", { name: /Submitted/ }).first().getByRole("button", { name: "Approve" }).click();
    await expect(pb.getByText(/Approved\./).first()).toBeVisible({ timeout: 60_000 });

    // --- reports render
    await open(pb, "/projects/reports", "Reports");
    await expect(pb.getByRole("cell", { name: new RegExp(name) }).first()).toBeVisible({ timeout: 60_000 });

    // --- a user with no project permissions is refused
    await plain.page.goto("/projects/all", { waitUntil: "domcontentloaded" });
    await expect(plain.page.getByText(/have access to Projects|not available|permission/i).first()).toBeVisible({ timeout: 180_000 });
  } finally {
    await a.context.close();
    await b.context.close();
    await plain.context.close();
  }
});
