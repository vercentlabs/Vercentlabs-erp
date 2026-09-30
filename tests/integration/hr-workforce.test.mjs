// Real PostgreSQL integration test -- HR workforce (F381-F396): employee master and numbering,
// departments/designations/reporting line, joining with its onboarding checklist, and employee
// self-service. Explicit permission sets, RLS on.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const ROLES = {
  hrA: ALL_HR,
  hrB: ALL_HR,
  viewer: ["hr_payroll.view", "hr_payroll.employee.view"],
  ess: [], // an ordinary employee: no HR permissions at all
  nobody: [],
};

test("HR workforce against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hrw");
  const { api, run, denied, sql, users } = w;
  const emp = (extra = {}) => ({ firstName: "Asha", lastName: "Rao", employmentType: "permanent", joiningDate: "2026-01-05", ...extra });
  const ids = {};

  try {
    await t.test("F381/F382: an employee gets an immutable, sequential number from the configured pattern; bad data is refused", async () => {
      await run("hrA", (c, x) => api.saveHrSettings(c, x, { employeeNumberPrefix: "EMP", employeeNumberPadding: 4, defaultProbationMonths: 6 }));
      const a = await run("hrA", (c, x) => api.saveEmployee(c, x, emp({ firstName: "Asha", workEmail: "asha@co.test", pan: "ABCDE1234F", dateOfBirth: "1990-04-02", bankDetails: { accountHolder: "Asha Rao", accountNumber: "123456789012", ifsc: "HDFC0001234" } })));
      const b = await run("hrA", (c, x) => api.saveEmployee(c, x, emp({ firstName: "Bala", lastName: "Iyer", workEmail: "bala@co.test" })));
      assert.equal(a.employee_number, "EMP-0001");
      assert.equal(b.employee_number, "EMP-0002");
      assert.equal(a.status, "draft");
      assert.equal(a.probation_status, "on_probation");
      assert.equal(String(a.probation_end_date).slice(0, 10), "2026-07-05", "six months from joining");
      ids.a = a.id;
      ids.b = b.id;
      await denied("hrA", (c, x) => api.saveEmployee(c, x, emp({ workEmail: "asha@co.test" })), 409, "HR_EMPLOYEE_DUPLICATE");
      await denied("hrA", (c, x) => api.saveEmployee(c, x, emp({ pan: "ABCDE1234F", workEmail: "pan@co.test" })), 409, "HR_PAN_DUPLICATE");
      await denied("hrA", (c, x) => api.saveEmployee(c, x, emp({ pan: "abc" })), 400, "HR_PAN_INVALID");
      await denied("hrA", (c, x) => api.saveEmployee(c, x, emp({ bankDetails: { accountHolder: "X", accountNumber: "12", ifsc: "HDFC0001234" } })), 400, "HR_BANK_INVALID");
      await denied("hrA", (c, x) => api.saveEmployee(c, x, emp({ dateOfBirth: "2026-02-01" })), 400);
      await denied("viewer", (c, x) => api.saveEmployee(c, x, emp()), 403);
      // the number never changes and is never reused, even after a rejected create burned a number
      const c3 = await run("hrA", (c, x) => api.saveEmployee(c, x, emp({ firstName: "Chitra", workEmail: "chitra@co.test" })));
      assert.ok(Number(c3.employee_number.slice(4)) > 2);
      ids.c = c3.id;
    });

    await t.test("F383/F384/F386: departments nest without loops, designations are unique, branch must belong to the company", async () => {
      const eng = await run("hrA", (c, x) => api.saveDepartment(c, x, { code: "ENG", name: "Engineering" }));
      const be = await run("hrA", (c, x) => api.saveDepartment(c, x, { code: "ENG-BE", name: "Backend", parentDepartmentId: eng.id }));
      ids.eng = eng.id;
      ids.be = be.id;
      await denied("hrA", (c, x) => api.saveDepartment(c, x, { id: eng.id, code: "ENG", name: "Engineering", parentDepartmentId: be.id }), 400, "HR_DEPARTMENT_CYCLE");
      await denied("hrA", (c, x) => api.saveDepartment(c, x, { code: "ENG", name: "Dup" }), 409, "HR_DEPARTMENT_DUPLICATE");
      const dev = await run("hrA", (c, x) => api.saveDesignation(c, x, { code: "DEV", name: "Developer", grade: "G3" }));
      const lead = await run("hrA", (c, x) => api.saveDesignation(c, x, { code: "LEAD", name: "Team Lead", grade: "G4" }));
      ids.dev = dev.id;
      ids.lead = lead.id;
      await denied("hrA", (c, x) => api.saveDesignation(c, x, { code: "DEV", name: "Again" }), 409);
      await run("hrA", (c, x) => api.updateEmployee(c, x, ids.a, { departmentId: eng.id, designationId: dev.id, branchId: w.branchId, workLocation: "Pune" }));
      await run("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { departmentId: be.id, designationId: dev.id, managerEmployeeId: ids.a }));
      await denied("hrA", (c, x) => api.updateEmployee(c, x, ids.c, { branchId: "11111111-1111-4111-8111-111111111111" }), 400, "HR_BRANCH_NOT_FOUND");
      const depts = await run("hrA", (c, x) => api.listDepartments(c, x));
      assert.equal(depts.find((d) => d.code === "ENG-BE").parent_name, "Engineering");
    });

    await t.test("F385: the reporting line cannot loop (checked at draft)", async () => {
      await denied("hrA", (c, x) => api.updateEmployee(c, x, ids.a, { managerEmployeeId: ids.b }), 400, "HR_MANAGER_CYCLE");
      await denied("hrA", (c, x) => api.updateEmployee(c, x, ids.a, { managerEmployeeId: ids.a }), 400, "HR_MANAGER_CYCLE");
    });

    await t.test("F388/F389: joining activates the employee and raises the onboarding checklist, once", async () => {
      await denied("viewer", (c, x) => api.completeJoining(c, x, ids.a), 403);
      const joined = await run("hrA", (c, x) => api.completeJoining(c, x, ids.a));
      assert.equal(joined.status, "active");
      const tasks = await run("hrA", (c, x) => api.listLifecycleTasks(c, x, { employeeId: ids.a, kind: "onboarding" }));
      assert.equal(tasks.length, 4, "the default onboarding checklist");
      await run("hrA", (c, x) => api.completeLifecycleTask(c, x, tasks[0].id, { note: "done" }));
      await denied("hrA", (c, x) => api.completeLifecycleTask(c, x, tasks[0].id, {}), 409, "HR_TASK_STATE");
      await denied("hrA", (c, x) => api.completeJoining(c, x, ids.a), 409, "HR_JOINING_STATE");
      for (const id of [ids.b, ids.c]) await run("hrA", (c, x) => api.completeJoining(c, x, id));
    });

    await t.test("F383-F386: after joining, HR changes department, designation, reporting manager and branch directly; the joining date is fixed", async () => {
      await run("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { designationId: ids.lead, departmentId: ids.eng }));
      await run("hrA", (c, x) => api.updateEmployee(c, x, ids.c, { managerEmployeeId: ids.b }));
      const [b] = await sql(`SELECT designation_id, department_id FROM tenant.hr_employees WHERE id=$1`, [ids.b]);
      assert.equal(b.designation_id, ids.lead);
      assert.equal(b.department_id, ids.eng);
      await denied("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { managerEmployeeId: ids.c }), 400, "HR_MANAGER_CYCLE");
      await denied("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { joiningDate: "2026-02-01" }), 409, "HR_JOINING_DATE_LOCKED");
    });

    await t.test("F381/F396: sensitive fields are hidden without the sensitive permission; the employee always sees their own", async () => {
      const list = await run("viewer", (c, x) => api.listEmployees(c, x));
      const asha = list.find((e) => e.id === ids.a);
      assert.ok(asha, "the viewer can list employees");
      assert.equal(asha.bank_details, undefined);
      assert.equal(asha.tax_identifiers, undefined);
      assert.equal(asha.date_of_birth, undefined);
      const full = await run("hrA", (c, x) => api.getEmployee(c, x, ids.a));
      assert.equal(full.bank_details.ifsc, "HDFC0001234");
      assert.equal(full.date_of_birth, "1990-04-02", "a DATE is plain text, not a shifted timestamp");
      await denied("nobody", (c, x) => api.listEmployees(c, x), 403);
      // HR without the sensitive permission cannot change bank details
      await denied("viewer", (c, x) => api.updateEmployee(c, x, ids.a, { bankDetails: {} }), 403);
    });

    await t.test("F396: self-service -- own profile, limited edits and own tasks", async () => {
      await run("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { userId: users.ess }));
      const me = await run("ess", (c, x) => api.getMyProfile(c, x));
      assert.equal(me.id, ids.b);
      assert.equal(me.designation_name, "Team Lead");
      await run("ess", (c, x) => api.updateMyProfile(c, x, { personalPhone: "+91 98765 43210", emergencyContacts: [{ name: "Ravi", relationship: "Brother", phone: "+91 90000 11111" }] }));
      await denied("ess", (c, x) => api.updateMyProfile(c, x, { departmentId: ids.be }), 403, "HR_ESS_FIELD_BLOCKED");
      await denied("ess", (c, x) => api.updateMyProfile(c, x, { bankDetails: {} }), 403, "HR_ESS_FIELD_BLOCKED");
      await denied("ess", (c, x) => api.getEmployee(c, x, ids.a), 403); // someone else's record
      const [b] = await sql(`SELECT personal_phone FROM tenant.hr_employees WHERE id=$1`, [ids.b]);
      assert.equal(b.personal_phone, "+91 98765 43210");
      const mine = await run("ess", (c, x) => api.listLifecycleTasks(c, x));
      assert.ok(mine.every((tk) => tk.employee_id === ids.b), "an employee sees only their own tasks");
    });

    await t.test("F383/F384: a department or designation with current employees cannot be deactivated", async () => {
      await denied("hrA", (c, x) => api.saveDepartment(c, x, { id: ids.eng, code: "ENG", name: "Engineering", active: false }), 409, "HR_DEPARTMENT_IN_USE");
      await denied("hrA", (c, x) => api.saveDesignation(c, x, { id: ids.dev, code: "DEV", name: "Developer", active: false }), 409, "HR_DESIGNATION_IN_USE");
    });

    await t.test("dashboard and org chart", async () => {
      const d = await run("viewer", (c, x) => api.getWorkforceDashboard(c, x));
      assert.equal(d.headcount, 3, "a, b and c have joined");
      const chart = await run("viewer", (c, x) => api.getOrgChart(c, x));
      assert.equal(chart.find((n) => n.id === ids.c).manager_employee_id, ids.b);
      const events = await sql(`SELECT count(*)::int AS n FROM tenant.hr_payroll_events WHERE organization_id=$1 AND event_type='hr.employee.joined'`, [w.orgId]);
      assert.equal(events[0].n, 3, "every joining is in the audit trail");
    });

    await t.test("tenant isolation: another organization sees none of this", async () => {
      const other = await buildHrWorld(admin, { hr: ALL_HR }, "hrx");
      try {
        const list = await other.run("hr", (c, x) => api.listEmployees(c, x));
        assert.equal(list.length, 0);
        await other.denied("hr", (c, x) => api.getEmployee(c, x, ids.a), 404);
      } finally {
        await other.cleanup();
      }
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
