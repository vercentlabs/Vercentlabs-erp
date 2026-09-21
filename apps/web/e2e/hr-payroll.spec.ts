import { test, expect } from "@playwright/test";

import { api, getHrWorld, insertEmployee, open, openDenied, pick, withDb, type Rec } from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Payroll as real people: HR builds a salary structure that a second person approves, proposes pay
// that a second person approves, starts a payroll for one group, calculates it, submits it; the
// preparer cannot approve it, a second person does; the employee (self-service, no HR rights) then
// sees the payslip; and HR-only screens stay closed to them.
test("structure, pay, payroll run, maker-checker approval, employee payslip", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getHrWorld();
  const hrA = await openSession(browser, world.hrA);
  const hrB = await openSession(browser, world.hrB);
  const ess = await openSession(browser, world.ess);
  try {
    const s = world.suffix;
    // a period in a far-off year: whole months of "future" days count as paid, so no attendance is needed,
    // and a fresh year per run keeps the shared organisation's periods from colliding
    const year = 2040 + (parseInt(s.slice(-3), 36) % 50);
    const month = 1 + (parseInt(s.slice(0, 3), 36) % 12);
    const code = `${year}-${String(month).padStart(2, "0")}`;
    await withDb(world, (q) => q(`INSERT INTO tenant.hr_departments(organization_id,company_id,code,name,created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [world.organizationId, world.companyId, `PY${s}`.slice(0, 20), `Pay dept ${s}`, world.hrA.userId]));
    const deptId = String((await withDb(world, (q) => q(`SELECT id FROM tenant.hr_departments WHERE organization_id=$1 AND code=$2`, [world.organizationId, `PY${s}`.slice(0, 20)])))[0].id);
    const empId = await withDb(world, async (q) => {
      const rows = await q(
        `INSERT INTO tenant.hr_employees(organization_id,company_id,employee_number,first_name,last_name,employment_type,joining_date,status,user_id,department_id,bank_details,tax_identifiers,created_by) VALUES ($1,$2,$3,'Pay',$4,'permanent','2025-01-06','active',$5,$6,$7::jsonb,'{"pan":"ABCDE1234F"}'::jsonb,$8) RETURNING id`,
        [world.organizationId, world.companyId, `PE-${s}`, `Earner${s}`, world.ess.userId, deptId, JSON.stringify({ account_holder: "Pay Earner", account_number: "998877665544", ifsc: "SBIN0001234", bank_name: "SBI" }), world.hrA.userId],
      );
      return String(rows[0].id);
    });

    // --- components and a structure (API), approved on screen by the second person
    const c1 = `BAS${s}`.slice(0, 29);
    const c2 = `HRA${s}`.slice(0, 29);
    const c3 = `SPL${s}`.slice(0, 29);
    for (const [c, n, kind] of [[c1, "Basic", "basic"], [c2, "HRA", "allowance"], [c3, "Special", "allowance"]] as const) await api(hrA.context, "POST", "/actions/component-save", { code: c, name: `${n} ${s}`, componentType: "earning", componentKind: kind, pfWage: kind === "basic" });
    const st = await api<Rec>(hrA.context, "POST", "/actions/structure-create", { code: `ST${s}`.slice(0, 29), name: `Std ${s}`, lines: [{ componentCode: c1, percentage: 50 }, { componentCode: c2, percentage: 40, percentOf: c1 }, { componentCode: c3, isBalance: true }] });
    await api(hrA.context, "POST", "/actions/structure-submit", { id: st.body.record.id });
    const a = hrA.page;
    const b = hrB.page;
    await open(a, `/hr/structure/${st.body.record.id}`, `Std ${s}`);
    // the preparer sees no Approve button for a structure they submitted? they see it, but the server refuses
    await a.getByRole("button", { name: "Approve" }).click();
    await expect(a.getByRole("alert").filter({ hasText: /someone other than the people who prepared/i }).first()).toBeVisible({ timeout: 30_000 });
    await open(b, `/hr/structure/${st.body.record.id}`, `Std ${s}`);
    await b.getByRole("button", { name: "Approve" }).click();
    await expect(b.getByText("Approved. New pay can now be set on it.")).toBeVisible({ timeout: 30_000 });
    // the live preview
    await b.getByRole("button", { name: "Calculate" }).click();
    const breakup = b.getByRole("list", { name: "Monthly breakup" });
    await expect(breakup).toContainText(/Basic .*50,000\.00/, { timeout: 30_000 });
    await expect(breakup).toContainText(/Special .*30,000\.00/);

    // --- pay: proposed on screen by A, approved on screen by B
    await open(a, "/hr/compensation", "Compensation");
    await a.getByRole("button", { name: "Propose pay" }).click();
    let dlg = a.getByRole("dialog");
    await pick(a, dlg.getByRole("button", { name: /Select employee/ }), new RegExp(`Earner${s}`));
    await pick(a, dlg.getByRole("button", { name: /Select salary structure/ }), new RegExp(`Std ${s}`));
    await dlg.getByRole("textbox", { name: "Annual CTC" }).fill("1200000");
    await dlg.getByLabel("Effective from").fill("2025-01-06");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`Earner${s}.*Pending approval`) })).toBeVisible({ timeout: 60_000 });
    await a.getByRole("row", { name: new RegExp(`Earner${s}.*Pending approval`) }).getByRole("button", { name: "Approve" }).click();
    await a.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(a.getByRole("alert").filter({ hasText: /someone other than the person who proposed/i }).first()).toBeVisible({ timeout: 30_000 });
    await a.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
    await open(b, "/hr/compensation", "Compensation");
    await b.getByRole("row", { name: new RegExp(`Earner${s}.*Pending approval`) }).getByRole("button", { name: "Approve" }).click();
    await b.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`Earner${s}.*Active`) })).toBeVisible({ timeout: 60_000 });

    // --- the payroll: a period, a run for this department only, calculated
    await api(hrA.context, "POST", "/actions/periods-generate", { year });
    await open(a, "/hr/payroll-runs", "Payroll runs");
    await a.getByRole("button", { name: "Start payroll" }).click();
    dlg = a.getByRole("dialog");
    await pick(a, dlg.getByRole("button", { name: /Select payroll period/ }), new RegExp(code));
    await pick(a, dlg.getByRole("button", { name: /Select department/ }), new RegExp(`Pay dept ${s}`));
    await dlg.getByRole("button", { name: "Save" }).click();
    const runLink = a.getByRole("link", { name: new RegExp(`PAY-${code}`) }).first();
    await expect(runLink).toBeVisible({ timeout: 60_000 });
    await runLink.click();
    await expect(a.getByRole("heading", { name: new RegExp(`PAY-${code}`) })).toBeVisible({ timeout: 60_000 });
    await a.getByRole("button", { name: "Calculate" }).click();
    await expect(a.getByText("Calculated from attendance, leave and pay.")).toBeVisible({ timeout: 60_000 });
    const payslips = a.getByRole("list", { name: "Run payslips" });
    await expect(payslips).toContainText(new RegExp(`Earner${s}`), { timeout: 60_000 });
    await expect(payslips).toContainText(/gross 100,00\d\.\d\d.*net 100,00\d\.\d\d/);
    await expect(a.getByRole("list", { name: "Totals by component" })).toContainText(/Basic .*50,00\d\.\d\d/);
    // the same inputs give the same payslip
    await a.getByRole("button", { name: "Verify against a fresh calculation" }).click();
    await expect(a.getByText(/every one is identical/)).toBeVisible({ timeout: 60_000 });
    // warnings do not block: the employee has a PAN and a bank account, so there are none for them
    await a.getByRole("button", { name: "Submit for approval" }).click();
    await expect(a.getByText("Submitted for approval.")).toBeVisible({ timeout: 60_000 });

    // --- the preparer cannot approve; a second person can
    await a.getByRole("button", { name: "Approve" }).first().click();
    await a.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(a.getByRole("alert").filter({ hasText: /did not create, calculate or submit/i }).first()).toBeVisible({ timeout: 30_000 });
    await a.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
    // before approval the employee sees nothing
    await open(ess.page, "/hr/my-payslips", "My payslips");
    await expect(ess.page.getByRole("row", { name: new RegExp(`PS-PAY-${code}`) })).toHaveCount(0);
    await b.goto(a.url());
    await expect(b.getByRole("heading", { name: new RegExp(`PAY-${code}`) })).toBeVisible({ timeout: 60_000 });
    await b.getByRole("button", { name: "Approve" }).first().click();
    await b.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(b.getByText(/Approved\. Payslips are released/)).toBeVisible({ timeout: 60_000 });

    // --- the employee (no HR rights) now sees their own payslip, with the account masked
    await open(ess.page, "/hr/my-payslips", "My payslips");
    const mine = ess.page.getByRole("row", { name: new RegExp(`PS-PAY-${code}`) });
    await expect(mine).toBeVisible({ timeout: 60_000 });
    await mine.getByRole("link").first().click();
    await expect(ess.page.getByRole("heading", { name: /Payslip PS-PAY-/ })).toBeVisible({ timeout: 60_000 });
    await expect(ess.page.getByRole("list", { name: "Earnings" })).toContainText(/Special .*30,00\d\.\d\d/);
    await expect(ess.page.getByText(/••••5544/)).toBeVisible();
    await expect(ess.page.getByText("998877665544")).toHaveCount(0);
    // and the HR-only screens stay closed to them
    await openDenied(ess.page, "/hr/payroll-runs");
    await openDenied(ess.page, "/hr/compensation");
    expect((await api(ess.context, "GET", "/view/payroll-runs", undefined, false)).status).toBe(403);
    expect((await api(ess.context, "POST", "/actions/payroll-start", { periodId: "x" }, false)).status).toBe(403);
    void empId;
    void insertEmployee;
  } finally {
    await hrA.context.close();
    await hrB.context.close();
    await ess.context.close();
  }
});
