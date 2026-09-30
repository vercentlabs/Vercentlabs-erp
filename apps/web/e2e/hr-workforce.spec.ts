import { test, expect } from "@playwright/test";

import {
  api,
  getHrWorld,
  open,
  openDenied,
  pick,
  withDb,
  type Rec,
} from "./hr-fixtures";
import { openSalesSession as openSession } from "./sales-fixtures";

// Workforce as real people: HR creates and joins an employee, moves them to another department, the
// employee uses self-service (their own profile); and a user with no HR rights is kept out.
test("hire, join, change department and self-service; a user without HR rights is refused", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const world = await getHrWorld();
  const hrA = await openSession(browser, world.hrA);
  const ess = await openSession(browser, world.ess);
  const plain = await openSession(browser, world.plain);
  try {
    const s = world.suffix;
    const surname = `Tester${s}`;
    // setup that is not the point of this journey: two departments and a designation
    await api<Rec>(hrA.context, "POST", "/actions/department-save", {
      code: `D${s}`.slice(0, 20),
      name: `Dept ${s}`,
    });
    await api<Rec>(hrA.context, "POST", "/actions/department-save", {
      code: `E${s}`.slice(0, 20),
      name: `Dept2 ${s}`,
    });
    await api<Rec>(hrA.context, "POST", "/actions/designation-save", {
      code: `G${s}`.slice(0, 20),
      name: `Role ${s}`,
    });
    const a = hrA.page;

    // --- HR creates the employee on screen
    await open(a, "/hr/employees", "Employees");
    await a.getByRole("button", { name: "New employee" }).first().click();
    const dialog = a.getByRole("dialog");
    await dialog.getByLabel("First name").fill("Meera");
    await dialog.getByLabel("Last name").fill(surname);
    await dialog
      .getByLabel("Work email")
      .fill(`meera.${s.toLowerCase()}@co.test`);
    await dialog.getByLabel("Joining date").fill("2026-01-05");
    await pick(
      a,
      dialog.getByRole("button", { name: /Select department/ }),
      new RegExp(`Dept ${s}`),
    );
    await pick(
      a,
      dialog.getByRole("button", { name: /Select designation/ }),
      new RegExp(`Role ${s}`),
    );
    const letters = () =>
      Array.from(
        { length: 5 },
        () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)],
      ).join("");
    await dialog
      .getByLabel("PAN")
      .fill(
        `${letters()}${String(Math.floor(1000 + Math.random() * 9000))}${letters()[0]}`,
      );
    await dialog.getByRole("button", { name: "Save" }).click();
    const row = a.getByRole("row", {
      name: new RegExp(`Meera ${surname}.*Draft`),
    });
    await expect(row).toBeVisible({ timeout: 60_000 });
    const number = (await row.getByRole("link").first().innerText()).trim();
    expect(number).toMatch(/^EMP-\d+/);

    // --- joining activates the record and raises the onboarding checklist
    await a
      .getByRole("row", { name: new RegExp(`${surname}.*Draft`) })
      .getByRole("button", { name: "Complete joining" })
      .click();
    await expect(
      a.getByRole("row", { name: new RegExp(`${surname}.*Active`) }),
    ).toBeVisible({ timeout: 60_000 });
    await a.getByRole("link", { name: number }).click();
    await expect(
      a.getByRole("heading", { name: `Meera ${surname}` }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(a.getByRole("list", { name: "Checklists" })).toContainText(
      /Onboarding: Issue employee ID/,
    );
    await expect(a.getByText("On probation")).toBeVisible();

    // --- HR moves them to another department directly
    await open(a, "/hr/employees", "Employees");
    await a
      .getByRole("row", { name: new RegExp(`${surname}.*Active`) })
      .getByRole("button", { name: "Edit" })
      .click();
    await pick(
      a,
      a.getByRole("dialog").getByRole("button", { name: /Department/ }),
      new RegExp(`Dept2 ${s}`),
    );
    await a.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await open(a, "/hr/employees", "Employees");
    await expect(
      a.getByRole("row", { name: new RegExp(`${surname}.*Dept2 ${s}`) }),
    ).toBeVisible({ timeout: 60_000 });

    // --- the org chart shows them
    await open(a, "/hr/organization", "Organization");
    await expect(
      a.getByRole("list", { name: "Organization chart" }),
    ).toContainText(`Meera ${surname}`, { timeout: 60_000 });

    // --- self-service: link the ess user to this employee (an admin step), then use My profile
    await withDb(world, (q) =>
      q(
        `UPDATE tenant.hr_employees SET user_id=$1 WHERE employee_number=$2 AND organization_id=$3`,
        [world.ess.userId, number, world.organizationId],
      ),
    );
    const e = ess.page;
    await open(e, "/hr/me", "My profile");
    await expect(e.getByText(`Meera ${surname}`).first()).toBeVisible();
    await e.getByLabel("Mobile").fill("+91 98765 00000");
    await e.getByRole("button", { name: "Save contact details" }).click();
    await expect(e.getByText("Contact details saved.")).toBeVisible({
      timeout: 30_000,
    });
    // the employee cannot open HR registers
    await openDenied(e, "/hr/employees");

    // --- an employee-role user with no HR link gets a clear refusal, and no data
    await openDenied(plain.page, "/hr/employees");
    expect(
      (await api(plain.context, "GET", "/view/employees", undefined, false))
        .status,
    ).toBe(403);
    expect(
      (
        await api(
          plain.context,
          "POST",
          "/actions/employee-save",
          { firstName: "X", lastName: "Y", joiningDate: "2026-01-01" },
          false,
        )
      ).status,
    ).toBe(403);
  } finally {
    await hrA.context.close();
    await ess.context.close();
    await plain.context.close();
  }
});
