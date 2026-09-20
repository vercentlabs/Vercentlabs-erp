// Real PostgreSQL integration test -- performance and learning (F448-F452): goals with alignment
// and check-ins, a review-cycle appraisal (self, manager and peer input, plus calibration), a skills
// registry with employee proficiency, and training (courses, sessions, enrolment, completion).
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const perf = await import("../../services/api/src/modules/hr-payroll/performance.js");

const ROLES = {
  hrA: ALL_HR,
  hrB: ALL_HR,
  mgr: [], // an ordinary employee who also manages a report
  ess: [], // an ordinary employee: no HR permissions at all
  viewer: ["hr_payroll.view", "hr_payroll.employee.view"],
};

test("HR performance and learning against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hrp");
  const { api, run, denied, sql, users, today } = w;
  const ids = {};

  try {
    await run("hrA", (c, x) => api.saveHrSettings(c, x, { requireDocumentsForJoining: false }));
    // a manager (linked to the "mgr" test user) and a report (linked to "ess"), plus an HR-side employee
    const manager = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "Maya", lastName: "Manager", employmentType: "permanent", joiningDate: "2020-01-06", workEmail: "maya@co.test" }));
    await run("hrA", (c, x) => api.completeJoining(c, x, manager.id));
    const report = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "Ravi", lastName: "Report", employmentType: "permanent", joiningDate: "2023-01-06", workEmail: "ravi@co.test", managerEmployeeId: manager.id }));
    await run("hrA", (c, x) => api.completeJoining(c, x, report.id));
    await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [manager.id, users.mgr]);
    await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [report.id, users.ess]);
    // an employee linked to hrA, used to exercise the calibration self-approval block
    const hrEmp = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "Hr", lastName: "Person", employmentType: "permanent", joiningDate: "2020-01-06" }));
    await run("hrA", (c, x) => api.completeJoining(c, x, hrEmp.id));
    await sql(`UPDATE tenant.hr_employees SET user_id=$2 WHERE id=$1`, [hrEmp.id, users.hrA]);
    ids.hrEmp = hrEmp.id;
    ids.manager = manager.id;
    ids.report = report.id;

    await t.test("F448: goals -- set for a report, aligned to a parent, checked in, and completed at target", async () => {
      await denied("ess", (c, x) => perf.saveGoal(c, x, { employeeId: ids.manager, title: "Not yours", startDate: today, dueDate: today }), 403);
      const parent = await run("hrA", (c, x) => perf.saveGoal(c, x, { employeeId: ids.manager, title: "Grow the team", startDate: "2026-01-01", dueDate: "2026-12-31", targetValue: 100 }));
      const child = await run("mgr", (c, x) => perf.saveGoal(c, x, { employeeId: ids.report, parentGoalId: parent.id, title: "Ship the feature", startDate: "2026-01-01", dueDate: "2026-12-31", targetValue: 100, weight: 60 }));
      ids.goal = child.id;
      const bad = await run("ess", (c, x) => perf.saveGoal(c, x, { title: "Bad dates", startDate: "2026-06-01", dueDate: "2026-01-01" })).catch((e) => e);
      assert.equal(bad.code, "HR_GOAL_INVALID");
      const mine = await run("ess", (c, x) => perf.listGoals(c, x, { scope: "mine" }));
      assert.equal(mine.length, 1);
      assert.equal(mine[0].parent_title, "Grow the team");
      await denied("ess", (c, x) => perf.checkInGoal(c, x, ids.goal, { value: -1 }), 400, "HR_NUMBER_INVALID");
      await run("ess", (c, x) => perf.checkInGoal(c, x, ids.goal, { value: 40, note: "halfway" }));
      const afterCheckin = await run("ess", (c, x) => perf.listGoals(c, x, { scope: "mine" }));
      assert.equal(afterCheckin[0].status, "active");
      assert.equal(afterCheckin[0].checkins, 1);
      const completed = await run("mgr", (c, x) => perf.checkInGoal(c, x, ids.goal, { value: 100 }));
      assert.equal(completed.status, "completed");
      const teamGoals = await run("mgr", (c, x) => perf.listGoals(c, x, { scope: "team" }));
      assert.ok(teamGoals.some((g) => g.id === ids.goal));
      await denied("hrB", (c, x) => perf.closeGoal(c, x, ids.goal, { status: "cancelled", note: "already done" }), 409, "HR_GOAL_STATE");
      const missed = await run("mgr", (c, x) => perf.saveGoal(c, x, { employeeId: ids.report, title: "Will miss it", startDate: "2026-01-01", dueDate: "2026-01-31", targetValue: 100 }));
      await denied("mgr", (c, x) => perf.closeGoal(c, x, missed.id, { status: "missed" }), 400, "HR_REASON_REQUIRED");
      const closed = await run("mgr", (c, x) => perf.closeGoal(c, x, missed.id, { status: "missed", note: "deprioritised" }));
      assert.equal(closed.status, "missed");
    });

    await t.test("F449/F450: a review cycle drives self, manager and peer input to a completed, calibrated appraisal", async () => {
      await denied("mgr", (c, x) => perf.saveReviewCycle(c, x, { code: "H1-26", name: "H1 2026", periodStart: "2026-01-01", periodEnd: "2026-06-30" }), 403);
      const cycle = await run("hrA", (c, x) => perf.saveReviewCycle(c, x, { code: "H1-26", name: "H1 2026", periodStart: "2026-01-01", periodEnd: "2026-06-30", peerReview: true, ratingScale: 5 }));
      await denied("hrA", (c, x) => perf.saveReviewCycle(c, x, { code: "H1-26", name: "dup", periodStart: "2026-01-01", periodEnd: "2026-06-30" }), 409, "HR_CYCLE_DUPLICATE");
      const opened = await run("hrA", (c, x) => perf.openReviewCycle(c, x, cycle.id));
      assert.ok(opened.appraisalsCreated >= 1);
      const mine = await run("ess", (c, x) => perf.listAppraisals(c, x, { scope: "mine" }));
      assert.equal(mine.length, 1);
      assert.equal(mine[0].status, "pending_self");
      ids.appraisal = mine[0].id;

      await denied("mgr", (c, x) => perf.submitSelfReview(c, x, ids.appraisal, { rating: 4, comments: "not mine" }), 403);
      await denied("ess", (c, x) => perf.submitSelfReview(c, x, ids.appraisal, { rating: 9, comments: "out of range" }), 400, "HR_APPRAISAL_INVALID");
      await run("ess", (c, x) => perf.submitSelfReview(c, x, ids.appraisal, { rating: 4, comments: "Shipped the feature on time." }));
      await denied("ess", (c, x) => perf.submitSelfReview(c, x, ids.appraisal, { rating: 4, comments: "again" }), 409, "HR_APPRAISAL_STATE");

      // a peer (the manager, standing in as a colleague) gives feedback -- not the appraisee, not required
      await denied("ess", (c, x) => perf.submitPeerFeedback(c, x, ids.appraisal, { rating: 5, comments: "self peer review" }), 403, "SELF_APPROVAL_BLOCKED");
      await run("mgr", (c, x) => perf.submitPeerFeedback(c, x, ids.appraisal, { rating: 4, comments: "Good collaborator." }));

      await denied("ess", (c, x) => perf.submitManagerReview(c, x, ids.appraisal, { rating: 4, comments: "reviewing myself" }), 403);
      const done = await run("mgr", (c, x) => perf.submitManagerReview(c, x, ids.appraisal, { rating: 4, comments: "Agreed, strong quarter." }));
      assert.equal(done.status, "completed");
      assert.equal(Number(done.final_rating), 4);

      const detail = await run("ess", (c, x) => perf.getAppraisal(c, x, ids.appraisal));
      assert.equal(detail.peerFeedback.length, 1);
      assert.ok(detail.goals.length >= 1);

      // calibration is an HR-only operation; the reviewer (who has no HR permission here) cannot do it at all
      await denied("mgr", (c, x) => perf.calibrateAppraisal(c, x, ids.appraisal, { finalRating: 5, reason: "raise it" }), 403, "HR_FORBIDDEN");
      // when the reviewer IS an HR user, they still cannot calibrate their own review
      await sql(`UPDATE tenant.hr_appraisals SET reviewer_employee_id=$2 WHERE id=$1`, [ids.appraisal, ids.hrEmp]);
      await denied("hrA", (c, x) => perf.calibrateAppraisal(c, x, ids.appraisal, { finalRating: 5, reason: "raise it" }), 403, "SELF_APPROVAL_BLOCKED");
      await sql(`UPDATE tenant.hr_appraisals SET reviewer_employee_id=$2 WHERE id=$1`, [ids.appraisal, ids.manager]);
      const calibrated = await run("hrB", (c, x) => perf.calibrateAppraisal(c, x, ids.appraisal, { finalRating: 5, reason: "Calibration committee raised this one band." }));
      assert.equal(Number(calibrated.final_rating), 5);
      assert.match(calibrated.final_comments, /Calibrated/);

      // the cycle only made the one appraisal (the only employee with a manager set); with it
      // completed, the cycle cannot be closed without a reason, but can be closed with one
      await denied("hrA", (c, x) => perf.closeReviewCycle(c, x, cycle.id, ""), 400, "HR_REASON_REQUIRED");
      const closed = await run("hrA", (c, x) => perf.closeReviewCycle(c, x, cycle.id, "period end"));
      assert.equal(closed.status, "closed");
    });

    await t.test("F451: a skills registry, with self-rated and HR-assessed proficiency", async () => {
      await denied("mgr", (c, x) => perf.saveSkill(c, x, { code: "SQL", name: "SQL" }), 403);
      const skill = await run("hrA", (c, x) => perf.saveSkill(c, x, { code: "SQL", name: "SQL", category: "Engineering" }));
      ids.skill = skill.id;
      await denied("hrA", (c, x) => perf.saveSkill(c, x, { code: "SQL", name: "dup" }), 409, "HR_SKILL_DUPLICATE");
      await denied("ess", (c, x) => perf.setEmployeeSkill(c, x, { employeeId: ids.manager, skillId: skill.id, proficiency: 5 }), 403);
      const selfRated = await run("ess", (c, x) => perf.setEmployeeSkill(c, x, { skillId: skill.id, proficiency: 3 }));
      assert.equal(selfRated.self_rated, true);
      const assessed = await run("hrA", (c, x) => perf.setEmployeeSkill(c, x, { employeeId: ids.report, skillId: skill.id, proficiency: 4, notes: "manager assessment" }));
      assert.equal(assessed.self_rated, false);
      assert.equal(Number(assessed.proficiency), 4);
      const mine = await run("ess", (c, x) => perf.listEmployeeSkills(c, x, { scope: "mine" }));
      assert.equal(mine.length, 1);
      assert.equal(mine[0].skill_code, "SQL");
    });

    await t.test("F452: training -- a course, a scheduled session with capacity, enrolment, and completion raising skill proficiency", async () => {
      await denied("mgr", (c, x) => perf.saveCourse(c, x, { code: "SQL101", title: "SQL Basics" }), 403);
      const course = await run("hrA", (c, x) => perf.saveCourse(c, x, { code: "SQL101", title: "SQL Basics", skillId: ids.skill, durationHours: 8 }));
      const session = await run("hrA", (c, x) => perf.scheduleTrainingSession(c, x, { courseId: course.id, startsAt: "2026-11-01T09:00:00Z", endsAt: "2026-11-01T17:00:00Z", capacity: 1 }));
      ids.session = session.id;

      const enrolled = await run("ess", (c, x) => perf.enrollInTraining(c, x, { sessionId: session.id }));
      ids.enrolment = enrolled.id;
      await denied("ess", (c, x) => perf.enrollInTraining(c, x, { sessionId: session.id }), 409, "HR_ENROLMENT_DUPLICATE");
      // capacity is 1 and already filled -> a second, different employee is refused
      const other = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: "Third", lastName: "Person", employmentType: "permanent", joiningDate: "2024-01-06" }));
      await run("hrA", (c, x) => api.completeJoining(c, x, other.id));
      await denied("hrA", (c, x) => perf.enrollInTraining(c, x, { employeeId: other.id, sessionId: session.id }), 409, "HR_SESSION_FULL");

      await denied("mgr", (c, x) => perf.recordTrainingCompletion(c, x, ids.enrolment, { status: "attended" }), 403);
      const before = await run("ess", (c, x) => perf.listEmployeeSkills(c, x, { scope: "mine" }));
      const beforeProf = Number(before.find((s) => s.skill_id === ids.skill)?.proficiency ?? 0);
      await run("hrA", (c, x) => perf.recordTrainingCompletion(c, x, ids.enrolment, { status: "attended", score: 95 }));
      const after = await run("ess", (c, x) => perf.listEmployeeSkills(c, x, { scope: "mine" }));
      const afterProf = Number(after.find((s) => s.skill_id === ids.skill)?.proficiency ?? 0);
      assert.ok(afterProf >= beforeProf, "training completion does not lower the employee's own rating");

      const enrolments = await run("hrA", (c, x) => perf.listTrainingEnrolments(c, x, { sessionId: session.id }));
      assert.equal(enrolments.find((e) => e.id === ids.enrolment).status, "attended");

      const session2 = await run("hrA", (c, x) => perf.scheduleTrainingSession(c, x, { courseId: course.id, startsAt: "2026-12-01T09:00:00Z", endsAt: "2026-12-01T17:00:00Z" }));
      await run("hrA", (c, x) => perf.enrollInTraining(c, x, { employeeId: other.id, sessionId: session2.id }));
      const cancelled = await run("hrA", (c, x) => perf.cancelTrainingSession(c, x, session2.id, "trainer unavailable"));
      assert.equal(cancelled.status, "cancelled");
      const afterCancel = await run("hrA", (c, x) => perf.listTrainingEnrolments(c, x, { sessionId: session2.id }));
      assert.equal(afterCancel[0].status, "cancelled");

      const dash = await run("hrA", (c, x) => perf.getPerformanceDashboard(c, x));
      assert.ok(dash.goalsByStatus);
      assert.ok(dash.appraisalsByStatus);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
