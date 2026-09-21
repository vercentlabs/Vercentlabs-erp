// Real PostgreSQL integration test -- HR workforce (F381-F396): employee master and numbering,
// departments/designations/reporting line, documents, joining, probation, transfers, promotions,
// separation and offboarding, and employee self-service. Explicit permission sets, RLS on.
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
  const { api, run, denied, sql, users, today } = w;
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

    await t.test("F388/F389: joining is blocked until the required documents are verified; then the employee is active with an onboarding checklist", async () => {
      const type = await run("hrA", (c, x) => api.saveDocumentType(c, x, { code: "ID", name: "Identity proof", requiredForJoining: true }));
      const expiring = await run("hrA", (c, x) => api.saveDocumentType(c, x, { code: "VISA", name: "Work permit", expiryTracked: true }));
      await denied("hrA", (c, x) => api.completeJoining(c, x, ids.a), 409, "HR_JOINING_DOCUMENTS_MISSING");
      await denied("hrA", (c, x) => api.addEmployeeDocument(c, x, { employeeId: ids.a, documentTypeId: expiring.id, fileReference: "s3://x/visa.pdf" }), 400, "HR_DOCUMENT_EXPIRY_REQUIRED");
      const d = await run("hrA", (c, x) => api.addEmployeeDocument(c, x, { employeeId: ids.a, documentTypeId: type.id, fileReference: "s3://x/id.pdf", fileName: "id.pdf" }));
      await denied("hrA", (c, x) => api.completeJoining(c, x, ids.a), 409, "HR_JOINING_DOCUMENTS_MISSING"); // submitted is not verified
      await denied("hrA", (c, x) => api.reviewEmployeeDocument(c, x, d.id, { verify: false }), 400, "HR_REASON_REQUIRED");
      await run("hrB", (c, x) => api.reviewEmployeeDocument(c, x, d.id, { verify: true }));
      const joined = await run("hrA", (c, x) => api.completeJoining(c, x, ids.a));
      assert.equal(joined.status, "active");
      const tasks = await run("hrA", (c, x) => api.listLifecycleTasks(c, x, { employeeId: ids.a, kind: "onboarding" }));
      assert.equal(tasks.length, 4, "the default onboarding checklist");
      await run("hrA", (c, x) => api.completeLifecycleTask(c, x, tasks[0].id, { note: "done" }));
      await denied("hrA", (c, x) => api.completeLifecycleTask(c, x, tasks[0].id, {}), 409, "HR_TASK_STATE");
      await denied("hrA", (c, x) => api.completeJoining(c, x, ids.a), 409, "HR_JOINING_STATE");
      // documents expiring soon appear in the expiry view
      await run("hrA", (c, x) => api.addEmployeeDocument(c, x, { employeeId: ids.a, documentTypeId: expiring.id, fileReference: "s3://x/v.pdf", expiresOn: new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10) }));
      const soon = await run("hrA", (c, x) => api.listEmployeeDocuments(c, x, { expiringInDays: 30 }));
      assert.equal(soon.length, 1);
      // b and c join too (their documents are verified by the second person)
      for (const id of [ids.b, ids.c]) {
        const doc = await run("hrA", (c, x) => api.addEmployeeDocument(c, x, { employeeId: id, documentTypeId: type.id, fileReference: `s3://x/${id}.pdf` }));
        await run("hrB", (c, x) => api.reviewEmployeeDocument(c, x, doc.id, { verify: true }));
        await run("hrA", (c, x) => api.completeJoining(c, x, id));
      }
    });

    await t.test("F392/F393: after joining, placement changes go through a request a second person approves; the effective date decides when it applies", async () => {
      await denied("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { designationId: ids.lead }), 409, "HR_USE_CHANGE_REQUEST");
      // a transfer that would loop the reporting line is refused when proposed
      await denied("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.a, changeType: "transfer", effectiveDate: today, managerEmployeeId: ids.b }), 400, "HR_MANAGER_CYCLE");
      const tr = await run("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.b, changeType: "transfer", effectiveDate: today, departmentId: ids.eng, reason: "Rebalancing" }));
      await denied("hrA", (c, x) => api.decideEmployeeChange(c, x, tr.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await denied("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.b, changeType: "transfer", effectiveDate: today, departmentId: ids.be }), 409, "HR_CHANGE_OPEN");
      const done = await run("hrB", (c, x) => api.decideEmployeeChange(c, x, tr.id, { approve: true }));
      assert.equal(done.status, "applied", "effective today, so it took effect at approval");
      const [row] = await sql(`SELECT department_id FROM tenant.hr_employees WHERE id=$1`, [ids.b]);
      assert.equal(row.department_id, ids.eng);
      // a promotion dated in the future is approved but waits
      const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
      const promo = await run("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.b, changeType: "promotion", effectiveDate: future, designationId: ids.lead, grade: "G4", proposedAnnualCtc: 1800000 }));
      const approved = await run("hrB", (c, x) => api.decideEmployeeChange(c, x, promo.id, { approve: true }));
      assert.equal(approved.status, "approved");
      assert.equal((await sql(`SELECT designation_id FROM tenant.hr_employees WHERE id=$1`, [ids.b]))[0].designation_id, ids.dev, "not yet");
      assert.equal((await run("hrA", (c, x) => api.applyDueEmployeeChanges(c, x))).applied, 0);
      await sql(`UPDATE tenant.hr_employee_changes SET effective_date=current_date WHERE id=$1`, [promo.id]);
      assert.equal((await run("hrA", (c, x) => api.applyDueEmployeeChanges(c, x))).applied, 1);
      const after = (await sql(`SELECT designation_id, grade FROM tenant.hr_employees WHERE id=$1`, [ids.b]))[0];
      assert.equal(after.designation_id, ids.lead);
      assert.equal(after.grade, "G4");
      // rejection needs a reason
      const rej = await run("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.c, changeType: "transfer", effectiveDate: today, workLocation: "Delhi" }));
      await denied("hrB", (c, x) => api.decideEmployeeChange(c, x, rej.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      assert.equal((await run("hrB", (c, x) => api.decideEmployeeChange(c, x, rej.id, { approve: false, note: "Not now" }))).status, "rejected");
    });

    await t.test("F390/F391: probation can be extended, then the employee is confirmed", async () => {
      const ext = await run("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.c, changeType: "probation_extension", effectiveDate: today, probationEndDate: "2026-12-31" }));
      await denied("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.c, changeType: "probation_extension", effectiveDate: today, probationEndDate: "2026-01-31" }), 409); // open extension exists
      await run("hrB", (c, x) => api.decideEmployeeChange(c, x, ext.id, { approve: true }));
      let [e] = await sql(`SELECT probation_status, probation_end_date::text FROM tenant.hr_employees WHERE id=$1`, [ids.c]);
      assert.equal(e.probation_status, "extended");
      assert.equal(e.probation_end_date, "2026-12-31");
      const reg = await run("hrA", (c, x) => api.listProbation(c, x));
      assert.ok(reg.some((r) => r.id === ids.c));
      const conf = await run("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.c, changeType: "confirmation", effectiveDate: today }));
      await run("hrB", (c, x) => api.decideEmployeeChange(c, x, conf.id, { approve: true }));
      [e] = await sql(`SELECT probation_status, confirmation_date::text FROM tenant.hr_employees WHERE id=$1`, [ids.c]);
      assert.equal(e.probation_status, "confirmed");
      assert.equal(e.confirmation_date, today);
      await denied("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.c, changeType: "confirmation", effectiveDate: today }), 409, "HR_CHANGE_STATE");
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

    await t.test("F396: self-service -- own profile, limited edits, bank change needs HR approval, own tasks and documents", async () => {
      await run("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { userId: users.ess }));
      const me = await run("ess", (c, x) => api.getMyProfile(c, x));
      assert.equal(me.id, ids.b);
      assert.equal(me.designation_name, "Team Lead");
      await run("ess", (c, x) => api.updateMyProfile(c, x, { personalPhone: "+91 98765 43210", emergencyContacts: [{ name: "Ravi", relationship: "Brother", phone: "+91 90000 11111" }] }));
      await denied("ess", (c, x) => api.updateMyProfile(c, x, { departmentId: ids.be }), 403, "HR_ESS_FIELD_BLOCKED");
      await denied("ess", (c, x) => api.updateMyProfile(c, x, { bankDetails: {} }), 403, "HR_ESS_FIELD_BLOCKED");
      await denied("ess", (c, x) => api.getEmployee(c, x, ids.a), 403); // someone else's record
      const req = await run("ess", (c, x) => api.requestProfileChange(c, x, { fieldGroup: "bank_details", payload: { accountHolder: "Bala Iyer", accountNumber: "998877665544", ifsc: "ICIC0004321", bankName: "ICICI" } }));
      assert.equal(req.status, "pending");
      await denied("ess", (c, x) => api.requestProfileChange(c, x, { fieldGroup: "bank_details", payload: { accountHolder: "Bala Iyer", accountNumber: "998877665544", ifsc: "ICIC0004321" } }), 409, "HR_PROFILE_CHANGE_OPEN");
      await denied("ess", (c, x) => api.decideProfileChange(c, x, req.id, { approve: true }), 403);
      await denied("viewer", (c, x) => api.listProfileChangeRequests(c, x), 403);
      assert.equal((await run("hrA", (c, x) => api.listProfileChangeRequests(c, x, { status: "pending" }))).length, 1);
      await run("hrB", (c, x) => api.decideProfileChange(c, x, req.id, { approve: true }));
      const [b] = await sql(`SELECT bank_details, personal_phone FROM tenant.hr_employees WHERE id=$1`, [ids.b]);
      assert.equal(b.bank_details.ifsc, "ICIC0004321");
      assert.equal(b.personal_phone, "+91 98765 43210");
      const mine = await run("ess", (c, x) => api.listLifecycleTasks(c, x));
      assert.ok(mine.every((tk) => tk.employee_id === ids.b), "an employee sees only their own tasks");
    });

    await t.test("F394/F395: separation -- resignation, acceptance, offboarding checklist, reassignment of reports, completion", async () => {
      // make c report to b so b has a direct report
      const tr = await run("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.c, changeType: "transfer", effectiveDate: today, managerEmployeeId: ids.b }));
      await run("hrB", (c, x) => api.decideEmployeeChange(c, x, tr.id, { approve: true }));
      await denied("ess", (c, x) => api.initiateSeparation(c, x, { employeeId: ids.a, separationType: "resignation", reason: "x" }), 403);
      await denied("ess", (c, x) => api.initiateSeparation(c, x, { separationType: "termination", reason: "x" }), 403);
      await denied("ess", (c, x) => api.initiateSeparation(c, x, { separationType: "resignation" }), 400, "HR_REASON_REQUIRED");
      const sep = await run("ess", (c, x) => api.initiateSeparation(c, x, { separationType: "resignation", reason: "Higher studies", noticeDate: today }));
      assert.equal(sep.status, "submitted");
      assert.equal(String(sep.requested_last_day).slice(0, 10), new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10), "the notice period from the employee's terms");
      await denied("ess", (c, x) => api.initiateSeparation(c, x, { separationType: "resignation", reason: "again" }), 409, "HR_SEPARATION_OPEN");
      await denied("ess", (c, x) => api.decideSeparation(c, x, sep.id, { approve: true }), 403);
      // the employee's own user (also given HR rights here) cannot accept their own resignation
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.b, users.hrB]);
      await denied("hrB", (c, x) => api.decideSeparation(c, x, sep.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.b, users.ess]);
      const acc = await run("hrA", (c, x) => api.decideSeparation(c, x, sep.id, { approve: true, lastWorkingDay: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) }));
      assert.equal(acc.status, "accepted");
      assert.equal((await sql(`SELECT status FROM tenant.hr_employees WHERE id=$1`, [ids.b]))[0].status, "on_notice");
      const off = await run("hrA", (c, x) => api.listLifecycleTasks(c, x, { employeeId: ids.b, kind: "offboarding" }));
      assert.equal(off.length, 4);
      await denied("hrA", (c, x) => api.completeSeparation(c, x, sep.id), 409, "HR_SEPARATION_NOT_DUE");
      await run("hrA", (c, x) => api.recordExitInterview(c, x, sep.id, { reasonCategory: "Studies", feedback: "Great team", wouldRejoin: true }));
      await sql(`UPDATE tenant.hr_separations SET last_working_day=current_date WHERE id=$1`, [sep.id]);
      await denied("hrA", (c, x) => api.completeSeparation(c, x, sep.id), 409, "HR_OFFBOARDING_OPEN");
      for (const tk of off) await run("hrA", (c, x) => tk.title.includes("dues") ? api.completeLifecycleTask(c, x, tk.id, { waive: true, note: "No dues" }) : api.completeLifecycleTask(c, x, tk.id, { note: "ok" }));
      await denied("hrA", (c, x) => api.completeSeparation(c, x, sep.id), 409, "HR_REPORTS_REASSIGN");
      const closed = await run("hrA", (c, x) => api.completeSeparation(c, x, sep.id, { reassignReportsTo: ids.a }));
      assert.equal(closed.status, "completed");
      const [b] = await sql(`SELECT status, separation_date::text FROM tenant.hr_employees WHERE id=$1`, [ids.b]);
      assert.equal(b.status, "separated");
      assert.equal(b.separation_date, today);
      assert.equal((await sql(`SELECT manager_employee_id FROM tenant.hr_employees WHERE id=$1`, [ids.c]))[0].manager_employee_id, ids.a);
      await denied("hrA", (c, x) => api.updateEmployee(c, x, ids.b, { workLocation: "x" }), 409, "HR_EMPLOYEE_CLOSED");
      await denied("hrA", (c, x) => api.proposeEmployeeChange(c, x, { employeeId: ids.b, changeType: "transfer", effectiveDate: today, workLocation: "x" }), 409, "HR_CHANGE_STATE");
    });

    await t.test("F394: a separation can be withdrawn while open, restoring the employee", async () => {
      const sep = await run("hrA", (c, x) => api.initiateSeparation(c, x, { employeeId: ids.c, separationType: "termination", reason: "Conduct" }));
      await denied("hrB", (c, x) => api.decideSeparation(c, x, sep.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      await run("hrB", (c, x) => api.decideSeparation(c, x, sep.id, { approve: true }));
      await denied("hrA", (c, x) => api.withdrawSeparation(c, x, sep.id, ""), 400, "HR_REASON_REQUIRED");
      await run("hrA", (c, x) => api.withdrawSeparation(c, x, sep.id, "Reconsidered"));
      assert.equal((await sql(`SELECT status FROM tenant.hr_employees WHERE id=$1`, [ids.c]))[0].status, "active");
      const open = await sql(`SELECT count(*)::int AS n FROM tenant.hr_lifecycle_tasks WHERE employee_id=$1 AND kind='offboarding' AND status='open'`, [ids.c]);
      assert.equal(open[0].n, 0, "offboarding tasks are waived with the withdrawal");
    });

    await t.test("F383/F384: a department or designation with current employees cannot be deactivated", async () => {
      await denied("hrA", (c, x) => api.saveDepartment(c, x, { id: ids.eng, code: "ENG", name: "Engineering", active: false }), 409, "HR_DEPARTMENT_IN_USE");
      await denied("hrA", (c, x) => api.saveDesignation(c, x, { id: ids.dev, code: "DEV", name: "Developer", active: false }), 409, "HR_DESIGNATION_IN_USE");
    });

    await t.test("dashboard, org chart and attrition report", async () => {
      const d = await run("viewer", (c, x) => api.getWorkforceDashboard(c, x));
      assert.equal(d.headcount, 2, "a and c are current; b has left");
      assert.equal(d.status.separated, 1);
      const chart = await run("viewer", (c, x) => api.getOrgChart(c, x));
      assert.ok(chart.find((n) => n.id === ids.c).manager_employee_id === ids.a);
      const attr = await run("hrA", (c, x) => api.getAttritionReport(c, x, { months: 12 }));
      assert.equal(attr.leavers, 1);
      assert.ok(attr.attritionPercent > 0);
      await denied("viewer", (c, x) => api.getAttritionReport(c, x, {}), 403);
      const events = await sql(`SELECT count(*)::int AS n FROM tenant.hr_payroll_events WHERE organization_id=$1 AND event_type='hr.separation.completed'`, [w.orgId]);
      assert.equal(events[0].n, 1, "every lifecycle step is in the audit trail");
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
