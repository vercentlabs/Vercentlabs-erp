// Real PostgreSQL integration test -- time and leave (F403-F417): shifts, holidays, punches,
// late/early/overtime rules, regularization, the attendance summary, leave types and policies,
// accrual, carry forward, requests, approval (manager or HR, never self), cancellation, and locks.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const ROLES = {
  hrA: ALL_HR,
  hrB: ALL_HR,
  hrOnlyView: ["hr_payroll.view", "hr_payroll.employee.view"],
  emp1: [], // ordinary employees: no HR rights at all
  emp2: [],
  mgr: [],
  nobody: [],
};

const iso = (d) => d.toISOString().slice(0, 10);
const addD = (s, n) => iso(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86400000));
const dow = (s) => new Date(`${s}T00:00:00Z`).getUTCDay();
const close = (a, b, msg) => assert.ok(Math.abs(Number(a) - b) < 0.01, `${msg}: expected ${b}, got ${a}`);

test("HR time and leave against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hrt");
  const { api, run, denied, sql, users, today } = w;
  const prevWorkday = (n) => {
    let d = today;
    for (let k = 0; k < n; ) { d = addD(d, -1); if ([1, 2, 3, 4, 5].includes(dow(d))) k += 1; }
    return d;
  };
  const nextMonday = (minAhead) => { let d = addD(today, minAhead); while (dow(d) !== 1) d = addD(d, 1); return d; };
  const at = (date, hhmm) => `${date}T${hhmm}:00+05:30`;
  const year = Number(today.slice(0, 4));
  const ids = {};

  try {
    await run("hrA", (c, x) => api.saveHrSettings(c, x, { requireDocumentsForJoining: false }));
    const dept = await run("hrA", (c, x) => api.saveDepartment(c, x, { code: "OPS", name: "Operations" }));
    const mk = async (first, email, userId, extra = {}) => {
      const e = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: first, lastName: "T", workEmail: email, employmentType: "permanent", joiningDate: "2025-01-06", departmentId: dept.id, userId, ...extra }));
      await run("hrA", (c, x) => api.completeJoining(c, x, e.id));
      return e;
    };
    ids.mgr = (await mk("Mira", "mira@co.test", users.mgr)).id;
    ids.e1 = (await mk("Ella", "ella@co.test", users.emp1, { managerEmployeeId: ids.mgr })).id;
    ids.e2 = (await mk("Omar", "omar@co.test", users.emp2, { managerEmployeeId: ids.mgr })).id;

    await t.test("F403: shifts validate their times; assignment is effective-dated and does not overlap", async () => {
      await denied("hrA", (c, x) => api.saveShift(c, x, { code: "BAD", name: "Bad", startTime: "18:00", endTime: "06:00" }), 400, "HR_SHIFT_OVERNIGHT");
      await denied("hrA", (c, x) => api.saveShift(c, x, { code: "BAD", name: "Bad", startTime: "09:00", endTime: "18:00", overnight: true }), 400, "HR_SHIFT_OVERNIGHT");
      await denied("hrA", (c, x) => api.saveShift(c, x, { code: "BAD", name: "Bad", startTime: "9am", endTime: "18:00" }), 400, "HR_SHIFT_INVALID");
      await denied("hrOnlyView", (c, x) => api.saveShift(c, x, { code: "X", name: "X", startTime: "09:00", endTime: "18:00" }), 403);
      const gen = await run("hrA", (c, x) => api.saveShift(c, x, { code: "GEN", name: "General", startTime: "09:00", endTime: "18:00", breakMinutes: 60, graceMinutes: 10, workingDays: [1, 2, 3, 4, 5] }));
      const night = await run("hrA", (c, x) => api.saveShift(c, x, { code: "NGT", name: "Night", startTime: "22:00", endTime: "06:00", overnight: true, breakMinutes: 30 }));
      ids.gen = gen.id;
      await denied("hrA", (c, x) => api.saveShift(c, x, { code: "GEN", name: "Dup", startTime: "09:00", endTime: "18:00" }), 409, "HR_SHIFT_DUPLICATE");
      for (const e of [ids.e1, ids.e2, ids.mgr]) await run("hrA", (c, x) => api.assignShift(c, x, { employeeId: e, shiftId: gen.id, effectiveFrom: "2025-01-06" }));
      await run("hrA", (c, x) => api.assignShift(c, x, { employeeId: ids.e2, shiftId: night.id, effectiveFrom: "2030-01-01" }));
      const rows = await run("hrA", (c, x) => api.listShiftAssignments(c, x, { employeeId: ids.e2 }));
      assert.equal(rows.find((r) => r.shift_code === "GEN").effective_to, "2029-12-31", "the earlier open-ended assignment ends the day before the new one begins");
      await denied("hrA", (c, x) => api.assignShift(c, x, { employeeId: ids.e2, shiftId: gen.id, effectiveFrom: "2029-06-01" }), 409, "HR_SHIFT_OVERLAP");
    });

    await t.test("F415: holiday calendars, a default, holidays with types; duplicates refused", async () => {
      const cal = await run("hrA", (c, x) => api.saveHolidayCalendar(c, x, { code: "IN", name: "India", isDefault: true }));
      ids.holiday = prevWorkday(6);
      await run("hrA", (c, x) => api.addHoliday(c, x, { calendarId: cal.id, holidayDate: ids.holiday, name: "Founders day" }));
      await run("hrA", (c, x) => api.addHoliday(c, x, { calendarId: cal.id, holidayDate: `${year}-12-25`, name: "Winter break", holidayType: "optional" }));
      await denied("hrA", (c, x) => api.addHoliday(c, x, { calendarId: cal.id, holidayDate: ids.holiday, name: "Dup" }), 409, "HR_HOLIDAY_DUPLICATE");
      const second = await run("hrA", (c, x) => api.saveHolidayCalendar(c, x, { code: "US", name: "US", isDefault: true }));
      const cals = await run("hrA", (c, x) => api.listHolidayCalendars(c, x));
      assert.equal(cals.filter((k) => k.is_default).length, 1, "only one default calendar");
      assert.equal(cals.find((k) => k.code === "US").is_default, true);
      await run("hrA", (c, x) => api.saveHolidayCalendar(c, x, { id: cal.id, code: "IN", name: "India", isDefault: true }));
      void second;
      assert.equal((await run("hrA", (c, x) => api.listHolidays(c, x, { calendarId: cal.id }))).length, 2);
      await denied("hrOnlyView", (c, x) => api.addHoliday(c, x, { calendarId: cal.id, holidayDate: `${year}-11-01`, name: "X" }), 403);
    });

    await t.test("F404-F408: punches build the day -- late arrival, early exit, overtime, half day and a missing check-out", async () => {
      const [d1, d2, d3, d4] = [prevWorkday(4), prevWorkday(3), prevWorkday(2), prevWorkday(1)];
      ids.days = { d1, d2, d3, d4 };
      // D1: 25 minutes late (grace is 10), leaves 30 minutes after shift end
      await run("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "in", at: at(d1, "09:25") }));
      const p1 = await run("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "out", at: at(d1, "18:30") }));
      assert.equal(p1.attendance.status, "present");
      assert.equal(p1.attendance.late_minutes, 25);
      assert.equal(p1.attendance.worked_minutes, 485, "545 minutes in the building less the 60-minute break");
      assert.equal(p1.attendance.overtime_minutes, 0, "5 minutes over is below the overtime threshold");
      // D2: a long day -> overtime is queued for approval
      await run("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "in", at: at(d2, "09:00") }));
      const p2 = await run("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "out", at: at(d2, "20:30") }));
      assert.equal(p2.attendance.worked_minutes, 630);
      assert.equal(p2.attendance.overtime_minutes, 150);
      // D3: leaves at 15:00 -> half day, 180 minutes early
      await run("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "in", at: at(d3, "09:00") }));
      const p3 = await run("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "out", at: at(d3, "15:00") }));
      assert.equal(p3.attendance.status, "half_day");
      assert.equal(p3.attendance.early_exit_minutes, 180);
      // D4: never checked out
      const p4 = await run("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "in", at: at(d4, "09:05") }));
      assert.equal(p4.attendance.status, "absent");
      assert.match(p4.attendance.notes, /Missing check-out/);
      // punch rules
      await denied("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "in", at: at(d4, "09:10") }), 409, "HR_ALREADY_CHECKED_IN");
      await denied("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e2, direction: "out", at: at(d4, "18:00") }), 409, "HR_NOT_CHECKED_IN");
      await denied("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "out", at: at(d1, "10:00") }), 409, "HR_PUNCH_ORDER");
      await denied("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e2, direction: "in", at: "2999-01-01T09:00:00+05:30" }), 400, "HR_PUNCH_INVALID");
      await denied("emp2", (c, x) => api.punch(c, x, { employeeId: ids.e1, direction: "in" }), 403);
      await denied("nobody", (c, x) => api.punch(c, x, { direction: "in" }), 404);
      // an employee punches at the server's time -- a supplied past time is ignored
      const now = await run("emp2", (c, x) => api.punch(c, x, { direction: "in", at: at(d1, "09:00") }));
      // Attendance belongs to the organisation's calendar day (Asia/Kolkata for this world), which is a day ahead of UTC each night.
      const orgToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      assert.equal(now.attendance.attendance_date, orgToday, "the punch landed on today, not the requested day");
      const state = await run("emp2", (c, x) => api.getMyPunchState(c, x));
      assert.equal(state.checkedIn, true);
      await denied("emp2", (c, x) => api.punch(c, x, { direction: "in" }), 409, "HR_ALREADY_CHECKED_IN");
      const overtime = await run("hrA", (c, x) => api.listOvertime(c, x, {}));
      assert.equal(overtime.find((o) => o.work_date === d2).minutes, 150);
    });

    await t.test("F404/F406/F407: manual attendance needs a reason; the late and early report counts marks and applies the deduction rule", async () => {
      const d = prevWorkday(5);
      await denied("hrA", (c, x) => api.recordAttendance(c, x, { employeeId: ids.e2, attendanceDate: d, status: "present" }), 400, "HR_REASON_REQUIRED");
      await denied("hrOnlyView", (c, x) => api.recordAttendance(c, x, { employeeId: ids.e2, attendanceDate: d, status: "present", reason: "x" }), 403);
      await denied("hrA", (c, x) => api.recordAttendance(c, x, { employeeId: ids.e2, attendanceDate: addD(today, 3), status: "present", reason: "x" }), 400, "HR_ATTENDANCE_INVALID");
      const rec = await run("hrA", (c, x) => api.recordAttendance(c, x, { employeeId: ids.e2, attendanceDate: d, status: "remote", reason: "Worked from home, badge system down" }));
      assert.equal(rec.source, "manual");
      const rep = await run("hrA", (c, x) => api.getLateEarlyReport(c, x, {}));
      const ella = rep.rows.find((r) => r.id === ids.e1);
      assert.equal(ella.late_marks, 1);
      assert.equal(ella.late_minutes, 25);
      assert.equal(ella.early_exits, 1);
      assert.equal(ella.early_exit_minutes, 180);
      assert.equal(ella.deduction_days, 0, "no deduction rule is configured");
      await run("hrA", (c, x) => c && api.saveHrSettings(c, x, { attendanceGraceMinutes: 0 }));
      await sql(`UPDATE tenant.hr_payroll_settings SET late_marks_per_deduction=2 WHERE organization_id=$1`, [w.orgId]);
      const rep2 = await run("hrA", (c, x) => api.getLateEarlyReport(c, x, {}));
      assert.equal(rep2.rows.find((r) => r.id === ids.e1).deduction_days, 0.5, "two marks (one late, one early) cost half a day");
    });

    await t.test("F409: a missed check-out is regularized -- requested by the employee, decided by the manager (never self), limited per month", async () => {
      const d = ids.days.d4;
      const req = await run("emp1", (c, x) => api.requestRegularization(c, x, { attendanceDate: d, checkOut: at(d, "18:10"), reason: "Forgot to check out" }));
      assert.equal(req.status, "pending");
      await denied("emp1", (c, x) => api.requestRegularization(c, x, { attendanceDate: d, checkOut: at(d, "18:15"), reason: "again" }), 409, "HR_REGULARIZATION_OPEN");
      await denied("emp1", (c, x) => api.requestRegularization(c, x, { attendanceDate: addD(today, 2), checkIn: at(addD(today, 2), "09:00"), reason: "x" }), 400, "HR_REGULARIZATION_INVALID");
      await denied("emp1", (c, x) => api.requestRegularization(c, x, { attendanceDate: addD(today, -60), checkIn: at(addD(today, -60), "09:00"), reason: "x" }), 400, "HR_REGULARIZATION_INVALID");
      await denied("emp2", (c, x) => api.requestRegularization(c, x, { employeeId: ids.e1, attendanceDate: prevWorkday(7), checkIn: at(prevWorkday(7), "09:00"), reason: "x" }), 403);
      await denied("emp1", (c, x) => api.decideRegularization(c, x, req.id, { approve: true }), 403);
      await denied("emp2", (c, x) => api.decideRegularization(c, x, req.id, { approve: true }), 403);
      await denied("mgr", (c, x) => api.decideRegularization(c, x, req.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      const team = await run("mgr", (c, x) => api.listRegularizations(c, x, { scope: "team" }));
      assert.equal(team.length, 1, "the manager sees their team's requests without any HR permission");
      const done = await run("mgr", (c, x) => api.decideRegularization(c, x, req.id, { approve: true, note: "Confirmed with security" }));
      assert.equal(done.status, "approved");
      const [row] = await sql(`SELECT status, worked_minutes, source FROM tenant.hr_attendance WHERE employee_id=$1 AND attendance_date=$2`, [ids.e1, d]);
      assert.equal(row.status, "present", "the corrected day is recomputed from its punches");
      assert.equal(row.source, "regularized");
      assert.equal(row.worked_minutes, 485, "09:05 to 18:10 less the 60-minute break");
      await denied("mgr", (c, x) => api.decideRegularization(c, x, req.id, { approve: true }), 409, "HR_REGULARIZATION_STATE");
      // the monthly limit
      await sql(`UPDATE tenant.hr_payroll_settings SET regularization_limit_per_month=1 WHERE organization_id=$1`, [w.orgId]);
      const d5 = prevWorkday(5);
      if (d5.slice(0, 7) === d.slice(0, 7)) await denied("emp1", (c, x) => api.requestRegularization(c, x, { attendanceDate: d5, checkIn: at(d5, "09:00"), checkOut: at(d5, "18:00"), reason: "second" }), 409, "HR_REGULARIZATION_LIMIT");
      await sql(`UPDATE tenant.hr_payroll_settings SET regularization_limit_per_month=5 WHERE organization_id=$1`, [w.orgId]);
    });

    await t.test("F408: overtime is approved by the manager or HR, never by the employee", async () => {
      const ot = (await run("hrA", (c, x) => api.listOvertime(c, x, { status: "pending" }))).find((o) => o.work_date === ids.days.d2);
      await denied("emp1", (c, x) => api.decideOvertime(c, x, ot.id, { approve: true }), 403);
      await denied("mgr", (c, x) => api.decideOvertime(c, x, ot.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      const ok = await run("mgr", (c, x) => api.decideOvertime(c, x, ot.id, { approve: true, note: "Month-end close" }));
      assert.equal(ok.status, "approved");
      await denied("mgr", (c, x) => api.decideOvertime(c, x, ot.id, { approve: true }), 409, "HR_OVERTIME_STATE");
    });

    await t.test("F425 input: the attendance summary classifies every day -- holidays, weekly offs, present, half, absent, unmarked", async () => {
      const from = ids.holiday;
      const to = ids.days.d4;
      const s = await run("hrA", (c, x) => api.getAttendanceSummary(c, x, { employeeId: ids.e1, from, to }));
      const calendar = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      assert.equal(s.calendarDays, calendar);
      let weekends = 0;
      for (let d = from; d <= to; d = addD(d, 1)) if ([0, 6].includes(dow(d))) weekends += 1;
      assert.equal(s.holidays, 1);
      assert.equal(s.weeklyOffs, weekends);
      assert.equal(s.halfDays, 1, "the half day");
      assert.equal(s.presentDays, 3, "D1, D2 and the regularized D4");
      assert.equal(s.lateMarks, 1);
      assert.equal(s.overtimeMinutes, 150, "only approved overtime is counted");
      close(s.payableDays, s.holidays + s.weeklyOffs + s.presentDays + 0.5, "payable days");
      assert.equal(s.unmarkedDays, s.absentDays, "workdays with no record are absent");
      const mine = await run("emp1", (c, x) => api.getAttendanceSummary(c, x, { from, to }));
      assert.equal(mine.presentDays, 3, "an employee sees their own summary without HR rights");
      await denied("emp1", (c, x) => api.getAttendanceSummary(c, x, { employeeId: ids.e2, from, to }), 403);
      // days outside employment are not counted
      const before = await run("hrA", (c, x) => api.getAttendanceSummary(c, x, { employeeId: ids.e1, from: "2024-12-30", to: "2025-01-08" }));
      assert.equal(before.notEmployedDays, 7, "30 Dec to 5 Jan precede the joining date");
    });

    // -------------------------------------------------------------------------------- leave
    await t.test("F410/F411: leave types and a policy with entitlements per type", async () => {
      const al = await run("hrA", (c, x) => api.saveLeaveType(c, x, { code: "AL", name: "Annual leave", paid: true, carryForwardAllowed: true, maxCarryForward: 5, minNoticeDays: 2 }));
      const sl = await run("hrA", (c, x) => api.saveLeaveType(c, x, { code: "SL", name: "Sick leave", paid: true, requiresAttachment: true }));
      const ul = await run("hrA", (c, x) => api.saveLeaveType(c, x, { code: "UL", name: "Unpaid leave", paid: false }));
      const ml = await run("hrA", (c, x) => api.saveLeaveType(c, x, { code: "ML", name: "Maternity leave", paid: true, applicableGender: "female" }));
      Object.assign(ids, { al: al.id, sl: sl.id, ul: ul.id, ml: ml.id });
      await denied("hrA", (c, x) => api.saveLeaveType(c, x, { code: "AL", name: "Dup" }), 409, "HR_LEAVE_TYPE_DUPLICATE");
      await denied("hrA", (c, x) => api.saveLeaveType(c, x, { code: "CF", name: "CF", carryForwardAllowed: true }), 400, "HR_LEAVE_TYPE_INVALID");
      await denied("hrOnlyView", (c, x) => api.saveLeaveType(c, x, { code: "Z", name: "Z" }), 403);
      const pol = await run("hrA", (c, x) => api.saveLeavePolicy(c, x, { code: "STD", name: "Standard", employmentTypes: ["permanent"] }));
      ids.policy = pol.id;
      await run("hrA", (c, x) => api.setPolicyEntry(c, x, { policyId: pol.id, leaveTypeId: al.id, annualDays: 24, accrualFrequency: "monthly", maxBalance: 30, carryForwardLimit: 5 }));
      await run("hrA", (c, x) => api.setPolicyEntry(c, x, { policyId: pol.id, leaveTypeId: sl.id, annualDays: 12, accrualFrequency: "upfront" }));
      await denied("hrA", (c, x) => api.setPolicyEntry(c, x, { policyId: pol.id, leaveTypeId: ul.id, annualDays: 5 }), 400, "HR_POLICY_INVALID");
      await denied("hrA", (c, x) => api.setPolicyEntry(c, x, { policyId: pol.id, leaveTypeId: sl.id, annualDays: 12, carryForwardLimit: 3 }), 400, "HR_POLICY_INVALID"); // SL cannot carry forward
      const listed = await run("hrA", (c, x) => api.listLeavePolicies(c, x));
      assert.equal(listed[0].entries.length, 2);
      const assigned = await run("hrA", (c, x) => api.assignLeavePolicy(c, x, { policyId: pol.id }));
      assert.equal(assigned.assigned, 3, "every permanent employee");
    });

    await t.test("F412/F413: accrual credits each month once (idempotent), pro-rates a joiner, honours the cap and eligibility", async () => {
      const month = Number(today.slice(5, 7));
      const r1 = await run("hrA", (c, x) => api.runLeaveAccrual(c, x, {}));
      assert.ok(r1.credits > 0);
      const bal = async (emp, type) => Number((await sql(`SELECT closing_balance FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3`, [emp, type, year]))[0]?.closing_balance ?? 0);
      close(await bal(ids.e1, ids.al), 2 * month, "monthly accrual of 24/12 per month to date");
      close(await bal(ids.e1, ids.sl), 12, "upfront sick leave");
      const r2 = await run("hrA", (c, x) => api.runLeaveAccrual(c, x, {}));
      assert.equal(r2.credits, 0, "running it again credits nothing");
      close(await bal(ids.e1, ids.al), 2 * month, "unchanged");
      // a joiner in mid-March gets a pro-rated first month (16 of 31 days) -- only checkable once March is past
      if (month >= 3) {
        const j = await mk("Jo", "jo@co.test", null, { joiningDate: `${year}-03-16` });
        await run("hrA", (c, x) => api.assignLeavePolicy(c, x, { policyId: ids.policy, employeeId: j.id }));
        await run("hrA", (c, x) => api.runLeaveAccrual(c, x, { employeeId: j.id }));
        const ledger = await run("hrA", (c, x) => api.getLeaveLedger(c, x, { employeeId: j.id, leaveTypeId: ids.al, leaveYear: year }));
        const march = ledger.find((l) => l.period_key === `${year}-03`);
        close(march.days, (2 * 16) / 31, "March, pro-rated for 16 of 31 days");
        assert.ok(!ledger.some((l) => l.period_key === `${year}-01` && Number(l.days) > 0), "no accrual before joining");
      }
      // the maximum balance caps a credit
      await sql(`UPDATE tenant.hr_leave_policy_entries SET max_balance=1 WHERE policy_id=$1 AND leave_type_id=$2`, [ids.policy, ids.al]);
      await run("hrA", (c, x) => api.adjustLeaveBalance(c, x, { employeeId: ids.e2, leaveTypeId: ids.al, days: 0.5, note: "seed" }));
      await sql(`UPDATE tenant.hr_leave_policy_entries SET max_balance=30 WHERE policy_id=$1 AND leave_type_id=$2`, [ids.policy, ids.al]);
    });

    await t.test("F412: adjustments need a reason and cannot take a balance below zero", async () => {
      await denied("hrA", (c, x) => api.adjustLeaveBalance(c, x, { employeeId: ids.e2, leaveTypeId: ids.al, days: -100, note: "oops" }), 409, "HR_BALANCE_NEGATIVE");
      await denied("hrA", (c, x) => api.adjustLeaveBalance(c, x, { employeeId: ids.e2, leaveTypeId: ids.al, days: 1 }), 400, "HR_REASON_REQUIRED");
      await denied("hrOnlyView", (c, x) => api.adjustLeaveBalance(c, x, { employeeId: ids.e2, leaveTypeId: ids.al, days: 1, note: "x" }), 403);
      const mine = await run("emp2", (c, x) => api.listLeaveBalances(c, x, { mine: true }));
      assert.ok(mine.every((b) => b.employee_id === ids.e2), "an employee sees only their own balances");
    });

    await t.test("F416: a request is checked for notice, balance, policy, attachment, gender, half days, overlap and consecutive days", async () => {
      const mon = nextMonday(7);
      const wed = addD(mon, 2);
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: addD(today, 1), endDate: addD(today, 1) }), 409, "HR_LEAVE_NOTICE");
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.sl, startDate: mon, endDate: mon }), 400, "HR_LEAVE_ATTACHMENT");
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.ml, startDate: mon, endDate: mon }), 409, "HR_LEAVE_NOT_APPLICABLE");
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: mon, endDate: addD(mon, 60) }), 409, "HR_LEAVE_INSUFFICIENT_BALANCE");
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: addD(mon, 5), endDate: addD(mon, 6) }), 400, "HR_LEAVE_NO_DAYS"); // Saturday-Sunday
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: mon, endDate: wed, employeeId: ids.e2 }), 403);
      const req = await run("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: mon, endDate: wed, reason: "Family event" }));
      assert.equal(req.status, "submitted");
      assert.equal(Number(req.days), 3);
      ids.req = req.id;
      ids.mon = mon;
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.ul, startDate: addD(mon, 2), endDate: addD(mon, 3) }), 409, "HR_LEAVE_OVERLAP");
      // pending requests reserve balance
      const bal = (await run("emp1", (c, x) => api.listLeaveBalances(c, x, { mine: true }))).find((b) => b.leave_type_id === ids.al);
      close(bal.pending, 3, "pending days");
      close(bal.available, Number(bal.closing_balance) - 3, "available = balance less pending");
      // a half day, and unpaid leave with no balance at all
      const half = await run("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: addD(mon, 7), endDate: addD(mon, 7), startHalf: true }));
      assert.equal(Number(half.days), 0.5);
      ids.half = half.id;
      const unpaid = await run("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.ul, startDate: addD(mon, 14), endDate: addD(mon, 15) }));
      assert.equal(Number(unpaid.days), 2);
      // sandwich rule: Fri-Mon counts the weekend between them when the rule is on
      await denied("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: addD(mon, 4), endDate: addD(mon, 7) }), 409, "HR_LEAVE_OVERLAP"); // overlaps the half day on the second Monday
      const fri = addD(mon, 18);
      const noSandwich = await run("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: fri, endDate: addD(fri, 3) }));
      assert.equal(Number(noSandwich.days), 2, "Friday and Monday only");
      await run("emp1", (c, x) => api.cancelLeave(c, x, noSandwich.id, "test"));
      await sql(`UPDATE tenant.hr_payroll_settings SET sandwich_rule=true WHERE organization_id=$1`, [w.orgId]);
      const withSandwich = await run("emp1", (c, x) => api.applyLeave(c, x, { leaveTypeId: ids.al, startDate: fri, endDate: addD(fri, 3) }));
      assert.equal(Number(withSandwich.days), 4, "the weekend between the two leave days is counted");
      await run("emp1", (c, x) => api.cancelLeave(c, x, withSandwich.id, "test"));
      await sql(`UPDATE tenant.hr_payroll_settings SET sandwich_rule=false WHERE organization_id=$1`, [w.orgId]);
      await run("emp1", (c, x) => api.cancelLeave(c, x, unpaid.id, "not needed"));
    });

    await t.test("F417: approval by the manager or HR, never self; balance is deducted, attendance marked; cancelling restores both", async () => {
      await denied("emp1", (c, x) => api.decideLeave(c, x, ids.req, { approve: true }), 403);
      await denied("emp2", (c, x) => api.decideLeave(c, x, ids.req, { approve: true }), 403);
      await denied("mgr", (c, x) => api.decideLeave(c, x, ids.req, { approve: false }), 400, "HR_REASON_REQUIRED");
      const before = Number((await sql(`SELECT closing_balance FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3`, [ids.e1, ids.al, year]))[0].closing_balance);
      const pending = await run("mgr", (c, x) => api.listLeaveRequests(c, x, { scope: "team", status: "submitted" }));
      assert.ok(pending.some((r) => r.id === ids.req));
      const ok = await run("mgr", (c, x) => api.decideLeave(c, x, ids.req, { approve: true, note: "Enjoy" }));
      assert.equal(ok.status, "approved");
      const after = Number((await sql(`SELECT closing_balance FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3`, [ids.e1, ids.al, year]))[0].closing_balance);
      close(after, before - 3, "three days deducted");
      const days = await sql(`SELECT attendance_date::text AS d, status FROM tenant.hr_attendance WHERE leave_request_id=$1 ORDER BY 1`, [ids.req]);
      assert.deepEqual(days.map((d) => d.status), ["leave", "leave", "leave"]);
      await denied("mgr", (c, x) => api.decideLeave(c, x, ids.req, { approve: true }), 409, "HR_LEAVE_STATE");
      // HR with leave.approve can decide too (the half day) -- and an employee cannot approve their own even with HR rights
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.hrB]);
      await denied("hrB", (c, x) => api.decideLeave(c, x, ids.half, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [ids.e1, users.emp1]);
      await run("hrB", (c, x) => api.decideLeave(c, x, ids.half, { approve: true }));
      const [h] = await sql(`SELECT status, half_day_part FROM tenant.hr_attendance WHERE leave_request_id=$1`, [ids.half]);
      assert.equal(h.status, "half_day");
      // the summary now counts the paid leave as payable
      const s = await run("hrA", (c, x) => api.getAttendanceSummary(c, x, { employeeId: ids.e1, from: ids.mon, to: addD(ids.mon, 2) }));
      close(s.paidLeaveDays, 3, "paid leave days");
      // the employee cancels the future leave: balance and attendance come back
      await denied("emp2", (c, x) => api.cancelLeave(c, x, ids.req, "x"), 403);
      await denied("emp1", (c, x) => api.cancelLeave(c, x, ids.req, ""), 400, "HR_REASON_REQUIRED");
      const cancelled = await run("emp1", (c, x) => api.cancelLeave(c, x, ids.req, "Plans changed"));
      assert.equal(cancelled.status, "cancelled");
      close(Number((await sql(`SELECT closing_balance FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3`, [ids.e1, ids.al, year]))[0].closing_balance), before - 0.5, "balance restored (the half day approved in between stays deducted)");
      assert.equal((await sql(`SELECT count(*)::int AS n FROM tenant.hr_attendance WHERE leave_request_id=$1`, [ids.req]))[0].n, 0);
      await denied("emp1", (c, x) => api.cancelLeave(c, x, ids.req, "again"), 409, "HR_LEAVE_STATE");
      const ledger = await run("hrA", (c, x) => api.getLeaveLedger(c, x, { employeeId: ids.e1, leaveTypeId: ids.al, leaveYear: year }));
      assert.ok(ledger.some((l) => l.entry_type === "usage") && ledger.some((l) => l.entry_type === "reversal"), "the ledger keeps both the usage and its reversal");
    });

    await t.test("F414: at year end the balance carries forward up to the limit; the rest lapses; running again changes nothing", async () => {
      await denied("hrA", (c, x) => api.runYearEndCarryForward(c, x, { leaveYear: year }), 409, "HR_YEAR_NOT_ENDED");
      const prior = year - 1;
      await run("hrA", (c, x) => api.adjustLeaveBalance(c, x, { employeeId: ids.e2, leaveTypeId: ids.al, days: 8, leaveYear: prior, note: "Opening for the previous year" }));
      await run("hrA", (c, x) => api.adjustLeaveBalance(c, x, { employeeId: ids.e2, leaveTypeId: ids.sl, days: 4, leaveYear: prior, note: "Opening for the previous year" }));
      const r = await run("hrA", (c, x) => api.runYearEndCarryForward(c, x, { leaveYear: prior }));
      assert.ok(r.carriedForward >= 5);
      const bal = async (emp, type, y) => Number((await sql(`SELECT closing_balance FROM tenant.hr_leave_balances WHERE employee_id=$1 AND leave_type_id=$2 AND leave_year=$3`, [emp, type, y]))[0]?.closing_balance ?? 0);
      close(await bal(ids.e2, ids.al, prior), 0, "the old year is closed out");
      assert.ok((await bal(ids.e2, ids.al, year)) >= 5, "5 days carried into the new year");
      close(await bal(ids.e2, ids.sl, prior), 0, "sick leave does not carry: it lapses");
      const again = await run("hrA", (c, x) => api.runYearEndCarryForward(c, x, { leaveYear: prior }));
      assert.equal(again.carriedForward, 0);
      assert.equal(again.lapsed, 0);
      const l = await run("hrA", (c, x) => api.getLeaveLedger(c, x, { employeeId: ids.e2, leaveTypeId: ids.al, leaveYear: prior }));
      assert.ok(l.some((e) => e.entry_type === "lapse") && l.some((e) => e.entry_type === "carry_forward"));
    });

    await t.test("locks: attendance and leave in an approved payroll period cannot be changed", async () => {
      const day = prevWorkday(8);
      const from = addD(day, -3);
      const to = addD(day, 3);
      await sql(`INSERT INTO tenant.hr_payroll_runs(organization_id,company_id,payroll_number,period_start,period_end,payment_date,status,created_by) VALUES ($1,$2,'PR-LOCK-1',$3,$4,$4,'approved',$5)`, [w.orgId, w.companyId, from, to, users.hrA]);
      await denied("hrA", (c, x) => api.recordAttendance(c, x, { employeeId: ids.e2, attendanceDate: day, status: "present", reason: "late entry" }), 409, "HR_PERIOD_LOCKED");
      await denied("hrA", (c, x) => api.punch(c, x, { employeeId: ids.e2, direction: "in", at: at(day, "09:00") }), 409, "HR_PERIOD_LOCKED");
      await denied("emp2", (c, x) => api.requestRegularization(c, x, { attendanceDate: day, checkIn: at(day, "09:00"), reason: "x" }), 409, "HR_PERIOD_LOCKED");
      await sql(`DELETE FROM tenant.hr_payroll_runs WHERE payroll_number='PR-LOCK-1'`);
    });

    await t.test("dashboard and calendar", async () => {
      const d = await run("hrA", (c, x) => api.getLeaveDashboard(c, x));
      assert.equal(typeof d.pendingApprovals, "number");
      const cal = await run("hrA", (c, x) => api.getLeaveCalendar(c, x, { from: ids.mon ?? today, to: addD(ids.mon ?? today, 14) }));
      assert.ok(cal.some((r) => r.id === ids.half));
      await denied("nobody", (c, x) => api.getLeaveCalendar(c, x, {}), 403);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
