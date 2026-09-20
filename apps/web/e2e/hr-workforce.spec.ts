import { test, expect } from "@playwright/test";

import { api, getHrWorld, open, openDenied, pick, withDb, type Rec } from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Workforce as real people: HR creates and joins an employee (documents verified by a second
// person), transfers them (second-person approval), the employee uses self-service (profile, bank
// change approved by HR, resignation), HR accepts it; and a user with no HR rights is kept out.
test("hire, join, transfer, self-service, resign and exit; a user without HR rights is refused", async ({ browser }) => {
  test.setTimeout(900_000);
  const world = await getHrWorld();
  const hrA = await openSession(browser, world.hrA);
  const hrB = await openSession(browser, world.hrB);
  const ess = await openSession(browser, world.ess);
  const plain = await openSession(browser, world.plain);
  try {
    const s = world.suffix;
    const surname = `Tester${s}`;
    // the organisation is shared: earlier runs left other "required for joining" types behind
    await withDb(world, (q) => q(`UPDATE tenant.hr_document_types SET required_for_joining=false WHERE organization_id=$1`, [world.organizationId]));
    // setup that is not the point of this journey: a document type, a department and a designation
    await api(hrA.context, "POST", "/actions/document-type-save", { code: `ID${s}`.slice(0, 20), name: `Identity ${s}`, requiredForJoining: true });
    await api<Rec>(hrA.context, "POST", "/actions/department-save", { code: `D${s}`.slice(0, 20), name: `Dept ${s}` });
    await api<Rec>(hrA.context, "POST", "/actions/department-save", { code: `E${s}`.slice(0, 20), name: `Dept2 ${s}` });
    await api<Rec>(hrA.context, "POST", "/actions/designation-save", { code: `G${s}`.slice(0, 20), name: `Role ${s}` });
    const a = hrA.page;

    // --- HR creates the employee on screen
    await open(a, "/hr/employees", "Employees");
    await a.getByRole("button", { name: "New employee" }).click();
    const dialog = a.getByRole("dialog");
    await dialog.getByLabel("First name").fill("Meera");
    await dialog.getByLabel("Last name").fill(surname);
    await dialog.getByLabel("Work email").fill(`meera.${s.toLowerCase()}@co.test`);
    await dialog.getByLabel("Joining date").fill("2026-01-05");
    await pick(a, dialog.getByRole("button", { name: /Select department/ }), new RegExp(`Dept ${s}`));
    await pick(a, dialog.getByRole("button", { name: /Select designation/ }), new RegExp(`Role ${s}`));
    const letters = () => Array.from({ length: 5 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)]).join("");
    await dialog.getByLabel("PAN").fill(`${letters()}${String(Math.floor(1000 + Math.random() * 9000))}${letters()[0]}`);
    await dialog.getByRole("button", { name: "Save" }).click();
    const row = a.getByRole("row", { name: new RegExp(`Meera ${surname}.*Draft`) });
    await expect(row).toBeVisible({ timeout: 60_000 });
    const number = (await row.getByRole("link").first().innerText()).trim();
    expect(number).toMatch(/^EMP-\d+/);

    // --- joining is refused until the required document is verified by someone else
    await row.getByRole("button", { name: "Complete joining" }).click();
    await expect(a.getByRole("alert").filter({ hasText: /documents must be verified/i }).first()).toBeVisible({ timeout: 30_000 });
    await open(a, "/hr/documents", "Employee documents");
    await a.getByRole("button", { name: "Add document" }).click();
    const doc = a.getByRole("dialog");
    await pick(a, doc.getByRole("button", { name: /Select employee/ }), new RegExp(surname));
    await pick(a, doc.getByRole("button", { name: /Select document type/ }), new RegExp(`Identity ${s}`));
    await doc.getByLabel(/File reference/).fill("vault://hr/id-proof.pdf");
    await doc.getByRole("button", { name: "Save" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Identity ${s}.*Submitted`) })).toBeVisible({ timeout: 60_000 });
    const b = hrB.page;
    await open(b, "/hr/documents", "Employee documents");
    await b.getByRole("row", { name: new RegExp(`${surname}.*Submitted`) }).getByRole("button", { name: "Verify" }).click();
    await b.getByRole("dialog").getByRole("button", { name: "Verify" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`${surname}.*Verified`) })).toBeVisible({ timeout: 60_000 });

    await open(a, "/hr/employees", "Employees");
    await a.getByRole("row", { name: new RegExp(`${surname}.*Draft`) }).getByRole("button", { name: "Complete joining" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Active`) })).toBeVisible({ timeout: 60_000 });
    await a.getByRole("link", { name: number }).click();
    await expect(a.getByRole("heading", { name: `Meera ${surname}` })).toBeVisible({ timeout: 60_000 });
    await expect(a.getByRole("list", { name: "Checklists" })).toContainText(/Onboarding: Issue employee ID/);
    await expect(a.getByText("On probation")).toBeVisible();

    // --- a transfer: proposed by one person, approved by another
    await open(a, "/hr/transfers", "Transfers");
    await a.getByRole("button", { name: "Propose transfer" }).click();
    const tr = a.getByRole("dialog");
    await pick(a, tr.getByRole("button", { name: /Select employee/ }), new RegExp(surname));
    await tr.getByLabel("Effective date").fill(new Date().toISOString().slice(0, 10));
    await pick(a, tr.getByRole("button", { name: /Select new department/ }), new RegExp(`Dept2 ${s}`));
    await tr.getByRole("button", { name: "Save" }).click();
    const pending = a.getByRole("row", { name: new RegExp(`${surname}.*Pending approval`) });
    await expect(pending).toBeVisible({ timeout: 60_000 });
    await pending.getByRole("button", { name: "Approve" }).click();
    await a.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(a.getByRole("alert").filter({ hasText: /someone other than the person who requested/i }).first()).toBeVisible({ timeout: 30_000 });
    await a.getByRole("dialog").getByRole("button", { name: "Close" }).last().click();
    await open(b, "/hr/transfers", "Transfers");
    await b.getByRole("row", { name: new RegExp(`${surname}.*Pending approval`) }).getByRole("button", { name: "Approve" }).click();
    await b.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`${surname}.*Applied`) })).toBeVisible({ timeout: 60_000 });
    await open(a, "/hr/employees", "Employees");
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Dept2 ${s}`) })).toBeVisible({ timeout: 60_000 });

    // --- the org chart shows them
    await open(a, "/hr/organization", "Organization");
    await expect(a.getByRole("list", { name: "Organization chart" })).toContainText(`Meera ${surname}`, { timeout: 60_000 });

    // --- self-service: link the ess user to this employee (an admin step), then use My profile
    await withDb(world, (q) => q(`UPDATE tenant.hr_employees SET user_id=$1 WHERE employee_number=$2 AND organization_id=$3`, [world.ess.userId, number, world.organizationId]));
    const e = ess.page;
    await open(e, "/hr/me", "My profile");
    await expect(e.getByText(`Meera ${surname}`).first()).toBeVisible();
    await e.getByLabel("Mobile").fill("+91 98765 00000");
    await e.getByRole("button", { name: "Save contact details" }).click();
    await expect(e.getByText("Contact details saved.")).toBeVisible({ timeout: 30_000 });
    await e.getByLabel("Account holder").fill(`Meera ${surname}`);
    await e.getByLabel("Account number").fill("112233445566");
    await e.getByLabel("IFSC").fill("SBIN0001234");
    await e.getByRole("button", { name: "Request bank change" }).click();
    await expect(e.getByText(/HR will review your bank details/)).toBeVisible({ timeout: 30_000 });
    // the employee cannot open HR registers
    await openDenied(e, "/hr/employees");
    // HR (a different person from the requester) approves the bank change
    await open(b, "/hr/profile-requests", "Profile change requests");
    const req = b.getByRole("row", { name: new RegExp(`${surname}.*Bank details.*••••5566.*Pending`) });
    await expect(req).toBeVisible({ timeout: 60_000 });
    await req.getByRole("button", { name: "Approve" }).click();
    await b.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
    await expect(b.getByRole("row", { name: new RegExp(`${surname}.*Approved`) })).toBeVisible({ timeout: 60_000 });

    // --- the employee resigns, HR accepts; the exit checklist appears
    await open(e, "/hr/me", "My profile");
    await e.getByLabel("Reason").fill("Relocating abroad");
    await e.getByRole("button", { name: "Submit resignation" }).click();
    await expect(e.getByText("Your resignation has been submitted.")).toBeVisible({ timeout: 30_000 });
    await open(a, "/hr/separations", "Separations");
    const sep = a.getByRole("row", { name: new RegExp(`${surname}.*Resignation.*Submitted`) });
    await expect(sep).toBeVisible({ timeout: 60_000 });
    await sep.getByRole("button", { name: "Accept" }).click();
    await a.getByRole("dialog").getByRole("button", { name: "Accept" }).click();
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Accepted`) })).toBeVisible({ timeout: 60_000 });
    await open(a, "/hr/offboarding", "Offboarding");
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*Return laptop`) })).toBeVisible({ timeout: 60_000 });
    await open(a, "/hr/employees", "Employees");
    await expect(a.getByRole("row", { name: new RegExp(`${surname}.*On notice`) })).toBeVisible({ timeout: 60_000 });

    // --- an employee-role user with no HR link gets a clear refusal, and no data
    await openDenied(plain.page, "/hr/employees");
    expect((await api(plain.context, "GET", "/view/employees", undefined, false)).status).toBe(403);
    expect((await api(plain.context, "POST", "/actions/employee-save", { firstName: "X", lastName: "Y", joiningDate: "2026-01-01" }, false)).status).toBe(403);
  } finally {
    await withDb(world, (q) => q(`UPDATE tenant.hr_document_types SET required_for_joining=false WHERE organization_id=$1`, [world.organizationId])).catch(() => undefined);
    await hrA.context.close();
    await hrB.context.close();
    await ess.context.close();
    await plain.context.close();
  }
});
