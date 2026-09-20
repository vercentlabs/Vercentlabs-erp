import { test, expect } from "@playwright/test";

import { getHrWorld, open, openDenied, pick, withDb, type HrWorld } from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Recruitment as real people: an opening approved by a second person, a candidate through the
// pipeline, an interview whose feedback is given by the interviewer (an ordinary employee with no HR
// rights), an offer approved by a second person, and conversion to an employee exactly once.
async function insertEmployee(world: HrWorld, number: string, first: string, last: string, userId: string | null) {
  return withDb(world, async (q) => {
    const rows = await q(
      `INSERT INTO tenant.hr_employees(organization_id,company_id,employee_number,first_name,last_name,employment_type,joining_date,status,user_id,created_by) VALUES ($1,$2,$3,$4,$5,'permanent','2025-01-06','active',$6,$7) RETURNING id`,
      [world.organizationId, world.companyId, number, first, last, userId, world.hrA.userId],
    );
    return String(rows[0].id);
  });
}

test("opening, candidate, pipeline, interview feedback, offer, conversion; one conversion only", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getHrWorld();
  const hrA = await openSession(browser, world.hrA);
  const hrB = await openSession(browser, world.hrB);
  const ess = await openSession(browser, world.ess);
  try {
    const s = world.suffix;
    const surname = `Cand${s}`;
    const title = `Engineer ${s}`;
    await insertEmployee(world, `RM-${s}`, "Hiring", `Manager${s}`, null);
    await insertEmployee(world, `RI-${s}`, "Inter", `Viewer${s}`, world.ess.userId);
    const a = hrA.page;
    const b = hrB.page;

    // --- an opening: prepared by A, approved by B (not by A)
    await open(a, "/hr/openings", "Job openings");
    await a.getByRole("button", { name: "New opening" }).click();
    let dlg = a.getByRole("dialog");
    await dlg.getByLabel("Title").fill(title);
    await dlg.getByRole("button", { name: "Save" }).click();
    const draft = a.getByRole("row", { name: new RegExp(`${title}.*Draft`) });
    await expect(draft).toBeVisible({ timeout: 60_000 });
    await draft.getByRole("button", { name: "Submit for approval" }).click();
    const pending = a.getByRole("row", { name: new RegExp(`${title}.*Pending approval`) });
    await expect(pending).toBeVisible({ timeout: 60_000 });
    await pending.getByRole("button", { name: "Approve" }).click();
    await a.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(a.getByRole("alert").filter({ hasText: /someone other than the person who requested/i }).first()).toBeVisible({ timeout: 30_000 });
    await a.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
    await open(b, "/hr/openings", "Job openings");
    await b.getByRole("row", { name: new RegExp(`${title}.*Pending approval`) }).getByRole("button", { name: "Approve" }).click();
    await b.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`${title}.*Open`) })).toBeVisible({ timeout: 60_000 });

    // --- a candidate, once (a second entry with the same email is refused)
    const email = `cand.${s.toLowerCase()}@mail.test`;
    await open(a, "/hr/candidates", "Candidates");
    for (const attempt of [1, 2]) {
      await a.getByRole("button", { name: "New candidate" }).click();
      dlg = a.getByRole("dialog");
      await dlg.getByLabel("First name").fill("Priya");
      await dlg.getByLabel("Last name").fill(surname);
      await dlg.getByLabel("Email").fill(email);
      await dlg.getByRole("button", { name: "Save" }).click();
      if (attempt === 1) await expect(a.getByRole("row", { name: new RegExp(`Priya ${surname}`) })).toBeVisible({ timeout: 60_000 });
      else {
        await expect(a.getByRole("alert").filter({ hasText: /already exists/i }).first()).toBeVisible({ timeout: 30_000 });
        await a.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
      }
    }

    // --- application, screening, interview scheduled for the ess employee
    await open(a, "/hr/applications", "Recruitment pipeline");
    await a.getByRole("button", { name: "New application" }).click();
    dlg = a.getByRole("dialog");
    await pick(a, dlg.getByRole("button", { name: /Select opening/ }), new RegExp(title));
    await pick(a, dlg.getByRole("button", { name: /Select candidate/ }), new RegExp(surname));
    await dlg.getByRole("button", { name: "Save" }).click();
    const app = a.getByRole("row", { name: new RegExp(`${surname}.*Applied`) });
    await expect(app).toBeVisible({ timeout: 60_000 });
    await app.getByRole("button", { name: "To screening" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Screening`) })).toBeVisible({ timeout: 60_000 });
    // an offer cannot come before any interview feedback
    await open(a, "/hr/interviews", "Interviews");
    await a.getByRole("button", { name: "Schedule interview" }).click();
    dlg = a.getByRole("dialog");
    await pick(a, dlg.getByRole("button", { name: /Select application/ }), new RegExp(surname));
    await pick(a, dlg.getByRole("button", { name: /Select interviewer/ }), new RegExp(`Viewer${s}`));
    const when = new Date(Date.now() + 2 * 3600000);
    await dlg.getByLabel("Date and time").fill(`${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}T${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Scheduled`) })).toBeVisible({ timeout: 60_000 });
    // the same interviewer cannot be booked twice at that time
    await a.getByRole("button", { name: "Schedule interview" }).click();
    dlg = a.getByRole("dialog");
    await pick(a, dlg.getByRole("button", { name: /Select application/ }), new RegExp(surname));
    await pick(a, dlg.getByRole("button", { name: /Select interviewer/ }), new RegExp(`Viewer${s}`));
    await dlg.getByLabel("Date and time").fill(`${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}T${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(a.getByRole("alert").filter({ hasText: /already has an interview at that time/i }).first()).toBeVisible({ timeout: 30_000 });
    await a.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();

    // --- the interview "has happened"; the interviewer (no HR rights) gives feedback on their own screen
    await withDb(world, (q) => q(`UPDATE tenant.hr_interviews SET scheduled_at = now() - interval '2 hours' WHERE organization_id=$1 AND status='scheduled'`, [world.organizationId]));
    const e = ess.page;
    await open(e, "/hr/my-interviews", "My interviews");
    const mine = e.getByRole("row", { name: new RegExp(`${surname}.*Scheduled`) });
    await expect(mine).toBeVisible({ timeout: 60_000 });
    await mine.getByRole("button", { name: "Give feedback" }).click();
    dlg = e.getByRole("dialog");
    await pick(e, dlg.getByRole("button", { name: /Select recommendation/ }), /^Strong yes/);
    await dlg.getByLabel("Feedback").fill("Excellent problem solving");
    await dlg.getByRole("button", { name: "Give feedback" }).click();
    await expect(e.getByRole("row", { name: new RegExp(`${surname}.*Completed.*Strong yes`) })).toBeVisible({ timeout: 60_000 });
    // and has no access to the HR registers
    await openDenied(e, "/hr/candidates");

    // --- offer stage, offer prepared by A, approved by B, sent, accepted, converted once
    await open(a, "/hr/applications", "Recruitment pipeline");
    await a.getByRole("row", { name: new RegExp(`${surname}.*Interview`) }).getByRole("button", { name: "To offer" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Offer`) })).toBeVisible({ timeout: 60_000 });
    await open(a, "/hr/offers", "Offers");
    await a.getByRole("button", { name: "New offer" }).click();
    dlg = a.getByRole("dialog");
    await pick(a, dlg.getByRole("button", { name: /Select application/ }), new RegExp(surname));
    await dlg.getByRole("textbox", { name: "Annual CTC" }).fill("1200000");
    const later = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
    await dlg.getByLabel("Joining date").fill(later(30));
    await dlg.getByLabel("Offer valid until").fill(later(7));
    await dlg.getByRole("button", { name: "Save" }).click();
    const offerRow = (status: string) => a.getByRole("row", { name: new RegExp(`${surname}.*${status}`) });
    await expect(offerRow("Draft")).toBeVisible({ timeout: 60_000 });
    await offerRow("Draft").getByRole("button", { name: "Submit for approval" }).click();
    await expect(offerRow("Pending approval")).toBeVisible({ timeout: 60_000 });
    await open(b, "/hr/offers", "Offers");
    await b.getByRole("row", { name: new RegExp(`${surname}.*Pending approval`) }).getByRole("button", { name: "Approve" }).click();
    await b.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`${surname}.*Approved`) })).toBeVisible({ timeout: 60_000 });
    await b.getByRole("row", { name: new RegExp(`${surname}.*Approved`) }).getByRole("button", { name: "Send to candidate" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`${surname}.*Sent`) })).toBeVisible({ timeout: 60_000 });
    await b.getByRole("row", { name: new RegExp(`${surname}.*Sent`) }).getByRole("button", { name: "Accepted" }).click();
    await b.getByRole("dialog").getByRole("button", { name: "Accepted" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`${surname}.*Accepted`) })).toBeVisible({ timeout: 60_000 });
    await b.getByRole("row", { name: new RegExp(`${surname}.*Accepted`) }).getByRole("button", { name: "Convert to employee" }).click();
    await expect(b.getByText("Employee created.")).toBeVisible({ timeout: 60_000 });
    // converted once: the action is gone from the row, and the employee is a pre-joining record
    await expect(b.getByRole("row", { name: new RegExp(`${surname}.*Accepted`) }).getByRole("button", { name: "Convert to employee" })).toHaveCount(0, { timeout: 30_000 });
    await open(b, "/hr/employees", "Employees");
    await expect(b.getByRole("row", { name: new RegExp(`Priya ${surname}.*Draft`) })).toBeVisible({ timeout: 60_000 });
    await open(b, "/hr/openings", "Job openings");
    await expect(b.getByRole("row", { name: new RegExp(`${title}.*1 of 1`) })).toBeVisible({ timeout: 60_000 });
  } finally {
    await hrA.context.close();
    await hrB.context.close();
    await ess.context.close();
  }
});
