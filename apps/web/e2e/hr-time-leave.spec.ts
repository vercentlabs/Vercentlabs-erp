import { test, expect } from "@playwright/test";

import { api, getHrWorld, insertEmployee, open, openDenied, pick, withDb, type Rec } from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Time and leave as real people: an ordinary employee checks in and out, applies for leave, their
// reporting manager (also an ordinary employee, no HR rights) approves it, the employee cancels it,
// asks for a missed punch to be corrected and the manager approves that. HR sees the registers; the
// employee cannot open them.
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addD = (s: string, n: number) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000));
const dow = (s: string) => new Date(`${s}T00:00:00Z`).getUTCDay();

test("check in and out, leave with manager approval, cancellation, attendance correction; HR registers are closed to the employee", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getHrWorld();
  const hrA = await openSession(browser, world.hrA);
  const emp = await openSession(browser, world.ess);
  const mgr = await openSession(browser, world.plain);
  try {
    const s = world.suffix;
    const today = iso(new Date());
    const managerId = await insertEmployee(world, `TM-${s}`, "Team", `Manager${s}`, { userId: world.plain.userId });
    const employeeId = await insertEmployee(world, `TE-${s}`, "Team", `Member${s}`, { userId: world.ess.userId, managerId });

    // --- HR sets up the policy (its screens are covered by the integration test)
    const al = await api<Rec>(hrA.context, "POST", "/actions/leave-type-save", { code: `A${s}`.slice(0, 20), name: `Annual ${s}`, paid: true });
    const policy = await api<Rec>(hrA.context, "POST", "/actions/leave-policy-save", { code: `P${s}`.slice(0, 20), name: `Policy ${s}`, employmentTypes: [] });
    await api(hrA.context, "POST", "/actions/policy-entry-set", { policyId: policy.body.record.id, leaveTypeId: al.body.record.id, annualDays: 24, accrualFrequency: "upfront" });
    await api(hrA.context, "POST", "/actions/policy-assign", { policyId: policy.body.record.id, employeeIds: [employeeId, managerId] });
    await api(hrA.context, "POST", "/actions/leave-accrual-run", { employeeId });

    // --- the employee checks in and out
    const e = emp.page;
    await open(e, "/hr/my-attendance", "Check in and out");
    await expect(e.getByText("Checked out").first()).toBeVisible({ timeout: 60_000 });
    await e.getByRole("button", { name: "Check in" }).click();
    await expect(e.getByText("Checked in.")).toBeVisible({ timeout: 30_000 });
    await expect(e.getByRole("button", { name: "Check in" })).toBeDisabled();
    await e.getByRole("button", { name: "Check out" }).click();
    await expect(e.getByText("Checked out.")).toBeVisible({ timeout: 30_000 });
    await expect(e.getByRole("row", { name: new RegExp(`${today}`) }).first()).toBeVisible({ timeout: 60_000 });

    // --- leave: apply on screen for two working days a fortnight away
    let monday = addD(today, 14);
    while (dow(monday) !== 1) monday = addD(monday, 1);
    await open(e, "/hr/my-leave", "My leave");
    await e.getByRole("button", { name: "Apply for leave" }).click();
    let dlg = e.getByRole("dialog");
    await pick(e, dlg.getByRole("button", { name: /Select leave type/ }), new RegExp(`Annual ${s}`));
    await dlg.getByLabel("From", { exact: true }).fill(monday);
    await dlg.getByLabel("To", { exact: true }).fill(addD(monday, 1));
    await dlg.getByLabel("Reason").fill("Family function");
    await dlg.getByRole("button", { name: "Save" }).click();
    const submitted = e.getByRole("row", { name: new RegExp(`Annual ${s}.*Submitted`) });
    await expect(submitted).toBeVisible({ timeout: 60_000 });
    // an employee has no approve action on their own request
    await expect(submitted.getByRole("button", { name: "Approve" })).toHaveCount(0);
    // asking again for the same days is refused with the reason
    await e.getByRole("button", { name: "Apply for leave" }).click();
    dlg = e.getByRole("dialog");
    await pick(e, dlg.getByRole("button", { name: /Select leave type/ }), new RegExp(`Annual ${s}`));
    await dlg.getByLabel("From", { exact: true }).fill(monday);
    await dlg.getByLabel("To", { exact: true }).fill(monday);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(e.getByRole("alert").filter({ hasText: /already has leave in that period/i }).first()).toBeVisible({ timeout: 30_000 });
    await e.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();

    // --- the manager (an ordinary employee) approves it from their team's screen
    const m = mgr.page;
    await open(m, "/hr/team-leave", "Team leave");
    const theirs = m.getByRole("row", { name: new RegExp(`Member${s}.*Annual ${s}.*Submitted`) });
    await expect(theirs).toBeVisible({ timeout: 60_000 });
    await theirs.getByRole("button", { name: "Approve" }).click();
    await m.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(m.getByRole("row", { name: new RegExp(`Member${s}.*Annual ${s}.*Approved`) })).toBeVisible({ timeout: 60_000 });

    // --- the employee sees the balance drop, then cancels the leave and the balance returns
    await open(e, "/hr/my-leave-balances", "My leave balances");
    const balance = e.getByRole("row", { name: new RegExp(`Annual ${s}`) });
    await expect(balance).toContainText("22", { timeout: 60_000 });
    await open(e, "/hr/my-leave", "My leave");
    await e.getByRole("row", { name: new RegExp(`Annual ${s}.*Approved`) }).getByRole("button", { name: "Cancel" }).click();
    await e.getByRole("dialog").getByLabel("Reason").fill("Plans changed");
    await e.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(e.getByRole("row", { name: new RegExp(`Annual ${s}.*Cancelled`) })).toBeVisible({ timeout: 60_000 });
    await open(e, "/hr/my-leave-balances", "My leave balances");
    await expect(e.getByRole("row", { name: new RegExp(`Annual ${s}`) })).toContainText("24", { timeout: 60_000 });

    // --- a day with a missing check-out is corrected: requested by the employee, approved by the manager
    let day = addD(today, -1);
    while (![1, 2, 3, 4, 5].includes(dow(day))) day = addD(day, -1);
    await withDb(world, (q) => q(`INSERT INTO tenant.hr_attendance(organization_id,company_id,employee_id,attendance_date,status,source,created_by) VALUES ($1,$2,$3,$4,'absent','system',$5) ON CONFLICT (employee_id,attendance_date) DO NOTHING`, [world.organizationId, world.companyId, employeeId, day, world.hrA.userId]));
    await open(e, "/hr/my-attendance", "Check in and out");
    const dayRow = e.getByRole("row", { name: new RegExp(`${day}.*Absent`) });
    await expect(dayRow).toBeVisible({ timeout: 60_000 });
    await dayRow.getByRole("button", { name: "Request correction" }).click();
    dlg = e.getByRole("dialog");
    await dlg.getByLabel("Correct check-in").fill(`${day}T09:00`);
    await dlg.getByLabel("Correct check-out").fill(`${day}T18:00`);
    await dlg.getByLabel("Why does this day need correcting?").fill("Badge reader was down");
    await dlg.getByRole("button", { name: "Request correction" }).click();
    await expect(e.getByText("Correction requested.")).toBeVisible({ timeout: 30_000 });
    await open(m, "/hr/team-corrections", "Team corrections");
    const corr = m.getByRole("row", { name: new RegExp(`Member${s}.*${day}.*Pending`) });
    await expect(corr).toBeVisible({ timeout: 60_000 });
    await corr.getByRole("button", { name: "Approve" }).click();
    await m.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(m.getByRole("row", { name: new RegExp(`Member${s}.*${day}.*Approved`) })).toBeVisible({ timeout: 60_000 });
    await open(e, "/hr/my-attendance", "Check in and out");
    await expect(e.getByRole("row", { name: new RegExp(`${day}.*Present`) })).toBeVisible({ timeout: 60_000 });

    // --- HR sees the registers; the employee is refused them
    await open(hrA.page, "/hr/attendance", "Attendance");
    await expect(hrA.page.getByRole("row", { name: new RegExp(`${day}.*Member${s}.*Present`) })).toBeVisible({ timeout: 60_000 });
    await open(hrA.page, "/hr/leave-requests", "Leave requests");
    await expect(hrA.page.getByRole("row", { name: new RegExp(`Member${s}.*Annual ${s}.*Cancelled`) })).toBeVisible({ timeout: 60_000 });
    await openDenied(e, "/hr/leave-requests");
    await openDenied(e, "/hr/attendance");
    expect((await api(emp.context, "GET", "/view/attendance", undefined, false)).status).toBe(403);
    expect((await api(emp.context, "POST", "/actions/shift-save", { code: "X", name: "X", startTime: "09:00", endTime: "18:00" }, false)).status).toBe(403);
  } finally {
    await hrA.context.close();
    await emp.context.close();
    await mgr.context.close();
  }
});
