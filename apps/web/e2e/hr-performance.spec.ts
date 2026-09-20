import { test, expect } from "@playwright/test";

import { api, getHrWorld, insertEmployee, open, openDenied, pick, type Rec } from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Performance and learning as real people: a manager (an ordinary employee, no HR rights) sets a goal
// for their report and checks it in; a review cycle drives a self review then a manager review to a
// completed appraisal; a skill is rated; a course session is scheduled, enrolled in and completed.
// HR does the setup (covered in depth by the integration test); this spec walks the screens.

test("goals, an appraisal cycle, a skill rating and training, walked through the screens", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getHrWorld();
  const hrA = await openSession(browser, world.hrA);
  const mgr = await openSession(browser, world.plain);
  const emp = await openSession(browser, world.ess);
  try {
    const s = world.suffix;
    const managerId = await insertEmployee(world, `PM-${s}`, "Perf", `Manager${s}`, { userId: world.plain.userId });
    const reportId = await insertEmployee(world, `PR-${s}`, "Perf", `Report${s}`, { userId: world.ess.userId, managerId });
    void reportId;

    // --- F448: the manager sets a goal for their report
    const m = mgr.page;
    await open(m, "/hr/team-goals", "Team goals");
    await m.getByRole("button", { name: "New goal" }).click();
    let dlg = m.getByRole("dialog");
    await pick(m, dlg.getByRole("button", { name: /Select employee/ }), new RegExp(`Report${s}`));
    await dlg.getByLabel("Title").fill(`Ship the ${s} feature`);
    await dlg.getByLabel("Start date").fill("2026-01-01");
    await dlg.getByLabel("Due date").fill("2026-12-31");
    await dlg.getByRole("button", { name: "Save" }).click();
    const goalRow = m.getByRole("row", { name: new RegExp(`Ship the ${s} feature`) });
    await expect(goalRow).toBeVisible({ timeout: 60_000 });
    await goalRow.getByRole("button", { name: "Check in" }).click();
    dlg = m.getByRole("dialog");
    await dlg.getByRole("textbox", { name: "Current value" }).fill("100");
    await dlg.getByRole("button", { name: "Check in" }).click();
    await expect(m.getByRole("row", { name: new RegExp(`Ship the ${s} feature.*Completed`) })).toBeVisible({ timeout: 60_000 });

    // the report sees the same goal under "My goals"
    const e = emp.page;
    await open(e, "/hr/my-goals", "My goals");
    await expect(e.getByRole("row", { name: new RegExp(`Ship the ${s} feature.*Completed`) })).toBeVisible({ timeout: 60_000 });

    // --- F449/F450: HR runs a review cycle; the report self-reviews, the manager completes it
    await open(hrA.page, "/hr/review-cycles", "Review cycles");
    await hrA.page.getByRole("button", { name: "New review cycle" }).click();
    dlg = hrA.page.getByRole("dialog");
    await dlg.getByLabel("Code").fill(`RC${s}`.slice(0, 20));
    await dlg.getByLabel("Name").fill(`Cycle ${s}`);
    await dlg.getByLabel("Period start").fill("2026-01-01");
    await dlg.getByLabel("Period end").fill("2026-12-31");
    await dlg.getByRole("button", { name: "Save" }).click();
    const cycleRow = hrA.page.getByRole("row", { name: new RegExp(`RC${s}`) });
    await expect(cycleRow).toBeVisible({ timeout: 60_000 });
    await cycleRow.getByRole("button", { name: "Open" }).click();
    await expect(hrA.page.getByText("Opened.")).toBeVisible({ timeout: 30_000 });

    await open(e, "/hr/my-appraisals", "My appraisals");
    const appraisalRow = e.getByRole("row", { name: new RegExp(`Cycle ${s}`) });
    await expect(appraisalRow).toBeVisible({ timeout: 60_000 });
    await appraisalRow.getByRole("button", { name: "Submit self review" }).click();
    dlg = e.getByRole("dialog");
    await dlg.getByRole("textbox", { name: "Rating" }).fill("4");
    await dlg.getByLabel("Comments").fill("Strong quarter, shipped on time.");
    await dlg.getByRole("button", { name: "Submit self review" }).click();
    await expect(e.getByRole("row", { name: new RegExp(`Cycle ${s}.*Pending manager`) })).toBeVisible({ timeout: 60_000 });

    await open(m, "/hr/appraisals-to-review", "Appraisals to review");
    const toReview = m.getByRole("row", { name: new RegExp(`Report${s}.*Cycle ${s}`) });
    await expect(toReview).toBeVisible({ timeout: 60_000 });
    await toReview.getByRole("button", { name: "Complete review" }).click();
    dlg = m.getByRole("dialog");
    await dlg.getByRole("textbox", { name: "Rating" }).fill("4");
    await dlg.getByLabel("Comments").fill("Agreed.");
    await dlg.getByRole("button", { name: "Complete review" }).click();
    await expect(m.getByRole("row", { name: new RegExp(`Report${s}.*Cycle ${s}.*Completed`) })).toBeVisible({ timeout: 60_000 });

    // --- F451: a skill is created by HR, then self-rated by the report
    const skillCode = `SK${s}`.slice(0, 20);
    await api<Rec>(hrA.context, "POST", "/actions/skill-save", { code: skillCode, name: `Skill ${s}` });
    await open(e, "/hr/my-skills", "My skills");
    await e.getByRole("button", { name: "Rate a skill" }).click();
    dlg = e.getByRole("dialog");
    await pick(e, dlg.getByRole("button", { name: /Select skill/ }), new RegExp(`Skill ${s}`));
    await dlg.getByRole("textbox", { name: "Proficiency (1-5)" }).fill("3");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(e.getByRole("row", { name: new RegExp(`Skill ${s}.*Self`) })).toBeVisible({ timeout: 60_000 });

    // --- F452: a course and session are scheduled by HR, enrolled in by the report, completed by HR
    const courseCode = `CR${s}`.slice(0, 20);
    const course = await api<Rec>(hrA.context, "POST", "/actions/course-save", { code: courseCode, title: `Course ${s}` });
    const future = new Date(Date.now() + 30 * 86400000);
    const session = await api<Rec>(hrA.context, "POST", "/actions/training-session-schedule", { courseId: course.body.record.id, startsAt: future.toISOString(), endsAt: new Date(future.getTime() + 3600_000).toISOString() });

    await open(e, "/hr/my-training", "My training");
    await e.getByRole("button", { name: "Enrol" }).click();
    dlg = e.getByRole("dialog");
    await pick(e, dlg.getByRole("button", { name: /Select session/ }), new RegExp(`Course ${s}`));
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(e.getByRole("row", { name: new RegExp(`Course ${s}.*Enrolled`) })).toBeVisible({ timeout: 60_000 });

    await open(hrA.page, "/hr/training-enrolments", "Training enrolments");
    const enrolRow = hrA.page.getByRole("row", { name: new RegExp(`Report${s}.*Course ${s}`) });
    await expect(enrolRow).toBeVisible({ timeout: 60_000 });
    await enrolRow.getByRole("button", { name: "Mark attended" }).click();
    dlg = hrA.page.getByRole("dialog");
    await dlg.getByRole("button", { name: "Mark attended" }).click();
    await expect(hrA.page.getByRole("row", { name: new RegExp(`Report${s}.*Course ${s}.*Attended`) })).toBeVisible({ timeout: 60_000 });

    // --- appraisal calibration is HR-only: the report cannot reach it
    await openDenied(e, "/hr/appraisals");
    expect((await api(emp.context, "GET", "/view/appraisals", undefined, false)).status).toBe(403);
    void session;
  } finally {
    await hrA.context.close();
    await mgr.context.close();
    await emp.context.close();
  }
});
