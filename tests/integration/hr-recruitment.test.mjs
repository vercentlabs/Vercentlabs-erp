// Real PostgreSQL integration test -- recruitment (F397-F402): openings with approval, candidates
// and de-duplication, the pipeline, interviews and feedback, offers with approval and range control,
// and conversion of an accepted offer into an employee.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_HR, buildHrWorld, connectAdmin } from "./hr-test-kit.mjs";

const ROLES = {
  hrA: ALL_HR,
  hrB: ALL_HR,
  recruiter: ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"], // no compensation or sensitive rights
  interviewer: [], // an ordinary employee
  nobody: [],
};

test("HR recruitment against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildHrWorld(admin, ROLES, "hrr");
  const { api, run, denied, sql, users, today } = w;
  const soon = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const ids = {};

  try {
    // an interviewer who is an employee (linked to the "interviewer" user) and a hiring manager
    const dept = await run("hrA", (c, x) => api.saveDepartment(c, x, { code: "ENG", name: "Engineering" }));
    const desig = await run("hrA", (c, x) => api.saveDesignation(c, x, { code: "DEV", name: "Developer" }));
    await run("hrA", (c, x) => api.saveHrSettings(c, x, { requireDocumentsForJoining: false }));
    const mk = async (first, email, userId) => {
      const e = await run("hrA", (c, x) => api.saveEmployee(c, x, { firstName: first, lastName: "Staff", workEmail: email, employmentType: "permanent", joiningDate: "2025-01-06", departmentId: dept.id, designationId: desig.id, userId }));
      await run("hrA", (c, x) => api.completeJoining(c, x, e.id));
      return e;
    };
    ids.manager = (await mk("Hema", "hema@co.test")).id;
    ids.interviewer = (await mk("Ivan", "ivan@co.test", users.interviewer)).id;
    ids.interviewer2 = (await mk("Isha", "isha@co.test")).id;

    await t.test("F397: an opening is requested, approved by a second person, then takes applications; a salary range needs sensitive rights", async () => {
      const o = await run("hrA", (c, x) => api.saveJobOpening(c, x, { title: "Backend Developer", departmentId: dept.id, designationId: desig.id, hiringManagerEmployeeId: ids.manager, positions: 2, salaryMin: 900000, salaryMax: 1500000, targetCloseDate: soon(30) }));
      assert.equal(o.status, "draft");
      assert.match(o.opening_number, /^JOB-\d+/);
      ids.opening = o.id;
      await denied("recruiter", (c, x) => api.saveJobOpening(c, x, { title: "X", salaryMin: 1 }), 403, "HR_SENSITIVE_FORBIDDEN");
      await denied("hrA", (c, x) => api.saveJobOpening(c, x, { title: "Bad", salaryMin: 5, salaryMax: 1 }), 400);
      await denied("hrA", (c, x) => api.saveJobOpening(c, x, { title: "Bad", targetCloseDate: "2020-01-01" }), 400);
      await denied("hrA", (c, x) => api.decideJobOpening(c, x, o.id, { approve: true }), 409, "HR_OPENING_STATE"); // not submitted
      await run("hrA", (c, x) => api.submitJobOpening(c, x, o.id));
      await denied("hrA", (c, x) => api.decideJobOpening(c, x, o.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await denied("hrB", (c, x) => api.decideJobOpening(c, x, o.id, { approve: false }), 400, "HR_REASON_REQUIRED");
      const open = await run("hrB", (c, x) => api.decideJobOpening(c, x, o.id, { approve: true }));
      assert.equal(open.status, "open");
      const listed = await run("recruiter", (c, x) => api.listJobOpenings(c, x));
      assert.equal(listed[0].salary_min, undefined, "the range is hidden from a role without sensitive access");
      const draft = await run("hrA", (c, x) => api.saveJobOpening(c, x, { title: "Draft role" }));
      await denied("hrA", (c, x) => api.applyToOpening(c, x, { openingId: draft.id, candidateId: "11111111-1111-4111-8111-111111111111" }), 409, "HR_OPENING_STATE");
    });

    await t.test("F398: candidates are captured once (email is the identity), referrals name the referrer, compensation is protected", async () => {
      const cand = await run("hrA", (c, x) => api.saveCandidate(c, x, { firstName: "Nila", lastName: "Kumar", email: "Nila@Mail.test", phone: "+91 90000 00001", source: "portal", experienceYears: 5, expectedCtc: 1300000, skills: "node, postgres" }));
      assert.match(cand.candidate_number, /^CAN-\d+/);
      assert.deepEqual(cand.skills, ["node", "postgres"]);
      ids.cand = cand.id;
      await denied("hrA", (c, x) => api.saveCandidate(c, x, { firstName: "Dup", lastName: "Kumar", email: "nila@mail.test" }), 409, "HR_CANDIDATE_DUPLICATE");
      await denied("hrA", (c, x) => api.saveCandidate(c, x, { firstName: "Ref", lastName: "Only", email: "ref@mail.test", source: "referral" }), 400, "HR_CANDIDATE_INVALID");
      await denied("recruiter", (c, x) => api.saveCandidate(c, x, { firstName: "Money", lastName: "Only", email: "money@mail.test", expectedCtc: 1 }), 403, "HR_SENSITIVE_FORBIDDEN");
      const plain = await run("recruiter", (c, x) => api.saveCandidate(c, x, { firstName: "Plain", lastName: "Person", email: "plain@mail.test", source: "referral", referredByEmployeeId: ids.manager }));
      ids.cand2 = plain.id;
      const seen = await run("recruiter", (c, x) => api.listCandidates(c, x));
      assert.equal(seen.find((r) => r.id === cand.id).expected_ctc, undefined);
      assert.equal((await run("hrA", (c, x) => api.listCandidates(c, x))).find((r) => r.id === cand.id).expected_ctc, "1300000.000000");
    });

    await t.test("F399: the pipeline moves one stage at a time; an offer needs interview feedback; reasons are recorded", async () => {
      const app = await run("hrA", (c, x) => api.applyToOpening(c, x, { openingId: ids.opening, candidateId: ids.cand }));
      ids.app = app.id;
      await denied("hrA", (c, x) => api.applyToOpening(c, x, { openingId: ids.opening, candidateId: ids.cand }), 409, "HR_APPLICATION_DUPLICATE");
      await denied("hrA", (c, x) => api.moveApplication(c, x, app.id, { stage: "interview" }), 409, "HR_APPLICATION_STAGE");
      await run("hrA", (c, x) => api.moveApplication(c, x, app.id, { stage: "screening" }));
      await denied("hrA", (c, x) => api.moveApplication(c, x, app.id, { stage: "offer" }), 409, "HR_APPLICATION_STAGE");
      await denied("hrA", (c, x) => api.moveApplication(c, x, app.id, { stage: "rejected" }), 400, "HR_REASON_REQUIRED");
      // a second application is rejected with a reason and is then final
      const app2 = await run("hrA", (c, x) => api.applyToOpening(c, x, { openingId: ids.opening, candidateId: ids.cand2 }));
      await run("hrA", (c, x) => api.moveApplication(c, x, app2.id, { stage: "rejected", reason: "Not enough experience" }));
      await denied("hrA", (c, x) => api.moveApplication(c, x, app2.id, { stage: "screening" }), 409, "HR_APPLICATION_STATE");
      assert.equal((await sql(`SELECT status FROM tenant.hr_candidates WHERE id=$1`, [ids.cand2]))[0].status, "rejected");
      const pipe = await run("recruiter", (c, x) => api.getRecruitmentPipeline(c, x));
      assert.equal(pipe.stages.screening, 1);
      assert.equal(pipe.stages.rejected, 1);
    });

    await t.test("F400: interviews clash-check the interviewer, only the interviewer gives feedback, and feedback gates the offer", async () => {
      const at = new Date(Date.now() + 2 * 3600000).toISOString();
      const iv = await run("hrA", (c, x) => api.scheduleInterview(c, x, { applicationId: ids.app, interviewerEmployeeId: ids.interviewer, scheduledAt: at, durationMinutes: 60, interviewType: "technical" }));
      ids.interview = iv.id;
      assert.equal(iv.round_number, 1);
      assert.equal((await sql(`SELECT stage FROM tenant.hr_applications WHERE id=$1`, [ids.app]))[0].stage, "interview", "scheduling moves the application into interview");
      await denied("hrA", (c, x) => api.scheduleInterview(c, x, { applicationId: ids.app, interviewerEmployeeId: ids.interviewer, scheduledAt: new Date(Date.parse(at) + 30 * 60000).toISOString() }), 409, "HR_INTERVIEW_CONFLICT");
      await denied("hrA", (c, x) => api.scheduleInterview(c, x, { applicationId: ids.app, interviewerEmployeeId: ids.interviewer, scheduledAt: "2020-01-01T10:00:00Z" }), 400, "HR_INTERVIEW_INVALID");
      await denied("hrA", (c, x) => api.moveApplication(c, x, ids.app, { stage: "offer" }), 409, "HR_NO_INTERVIEW_FEEDBACK");
      await denied("interviewer", (c, x) => api.submitInterviewFeedback(c, x, iv.id, { rating: 4, recommendation: "yes", feedback: "Good" }), 409, "HR_INTERVIEW_FUTURE");
      await sql(`UPDATE tenant.hr_interviews SET scheduled_at = now() - interval '2 hours' WHERE id=$1`, [iv.id]);
      await denied("nobody", (c, x) => api.submitInterviewFeedback(c, x, iv.id, { rating: 4, recommendation: "yes", feedback: "Good" }), 403);
      await denied("interviewer", (c, x) => api.submitInterviewFeedback(c, x, iv.id, { rating: 9, recommendation: "yes", feedback: "Good" }), 400, "HR_FEEDBACK_INVALID");
      const done = await run("interviewer", (c, x) => api.submitInterviewFeedback(c, x, iv.id, { rating: 4, recommendation: "yes", feedback: "Strong on databases" }));
      assert.equal(done.status, "completed");
      await denied("interviewer", (c, x) => api.submitInterviewFeedback(c, x, iv.id, { rating: 5, recommendation: "yes", feedback: "again" }), 409, "HR_INTERVIEW_STATE");
      const mine = await run("interviewer", (c, x) => api.listInterviews(c, x, {}));
      assert.equal(mine.length, 1, "an interviewer sees their own interviews without any HR permission");
      await denied("nobody", (c, x) => api.listInterviews(c, x, {}), 403);
      const apps = await run("hrA", (c, x) => api.listApplications(c, x, { openingId: ids.opening }));
      assert.equal(Number(apps.find((a) => a.id === ids.app).average_rating), 4);
      await run("hrA", (c, x) => api.moveApplication(c, x, ids.app, { stage: "offer" }));
    });

    await t.test("F401: an offer is prepared, approved by a second person within the salary range, sent and accepted or declined; expiry is honoured", async () => {
      await denied("recruiter", (c, x) => api.createOffer(c, x, { applicationId: ids.app, annualCtc: 1200000, joiningDate: soon(30), validUntil: soon(7) }), 403);
      await denied("hrA", (c, x) => api.createOffer(c, x, { applicationId: ids.app, annualCtc: 2000000, joiningDate: soon(30), validUntil: soon(7) }), 409, "HR_OFFER_OUTSIDE_RANGE");
      await denied("hrA", (c, x) => api.createOffer(c, x, { applicationId: ids.app, annualCtc: 1200000, joiningDate: soon(30), validUntil: "2020-01-01" }), 400, "HR_OFFER_INVALID");
      const offer = await run("hrA", (c, x) => api.createOffer(c, x, { applicationId: ids.app, annualCtc: 1200000, joiningDate: soon(30), validUntil: soon(7), terms: "Standard" }));
      assert.match(offer.offer_number, /^OFR-\d+/);
      ids.offer = offer.id;
      await denied("hrA", (c, x) => api.createOffer(c, x, { applicationId: ids.app, annualCtc: 1200000, joiningDate: soon(30), validUntil: soon(7) }), 409, "HR_OFFER_OPEN");
      await denied("hrA", (c, x) => api.sendOffer(c, x, offer.id), 409, "HR_OFFER_STATE"); // not approved
      await run("hrA", (c, x) => api.submitOffer(c, x, offer.id));
      await denied("hrA", (c, x) => api.decideOffer(c, x, offer.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await run("hrB", (c, x) => api.decideOffer(c, x, offer.id, { approve: true }));
      await run("hrA", (c, x) => api.sendOffer(c, x, offer.id));
      await denied("hrA", (c, x) => api.convertOfferToEmployee(c, x, offer.id), 409, "HR_OFFER_STATE"); // not accepted yet
      await denied("hrA", (c, x) => api.recordOfferDecision(c, x, offer.id, { accepted: false }), 400, "HR_REASON_REQUIRED");
      const acc = await run("hrA", (c, x) => api.recordOfferDecision(c, x, offer.id, { accepted: true }));
      assert.equal(acc.status, "accepted");
      // a range exception with a justification is allowed and recorded; a lapsed offer expires
      const c3 = await run("hrA", (c, x) => api.saveCandidate(c, x, { firstName: "Ravi", lastName: "Menon", email: "ravi@mail.test" }));
      const a3 = await run("hrA", (c, x) => api.applyToOpening(c, x, { openingId: ids.opening, candidateId: c3.id }));
      await run("hrA", (c, x) => api.moveApplication(c, x, a3.id, { stage: "screening" }));
      const iv3 = await run("hrA", (c, x) => api.scheduleInterview(c, x, { applicationId: a3.id, interviewerEmployeeId: ids.interviewer2, scheduledAt: new Date(Date.now() + 3600000).toISOString() }));
      const spare = await run("hrA", (c, x) => api.scheduleInterview(c, x, { applicationId: a3.id, interviewerEmployeeId: ids.interviewer2, scheduledAt: new Date(Date.now() + 26 * 3600000).toISOString(), interviewType: "hr" }));
      assert.equal(spare.round_number, 2);
      await denied("hrA", (c, x) => api.cancelInterview(c, x, spare.id, ""), 400, "HR_REASON_REQUIRED");
      assert.equal((await run("hrA", (c, x) => api.cancelInterview(c, x, spare.id, "Panel unavailable"))).status, "cancelled");
      await sql(`UPDATE tenant.hr_interviews SET scheduled_at = now() - interval '3 hours' WHERE id=$1`, [iv3.id]);
      await run("hrA", (c, x) => api.submitInterviewFeedback(c, x, iv3.id, { rating: 5, recommendation: "strong_yes", feedback: "Excellent" }));
      await run("hrA", (c, x) => api.moveApplication(c, x, a3.id, { stage: "offer" }));
      const o3 = await run("hrA", (c, x) => api.createOffer(c, x, { applicationId: a3.id, annualCtc: 1800000, justification: "Scarce skill", joiningDate: soon(20), validUntil: soon(3) }));
      assert.match(o3.terms, /Range exception: Scarce skill/);
      await run("hrA", (c, x) => api.submitOffer(c, x, o3.id));
      await run("hrB", (c, x) => api.decideOffer(c, x, o3.id, { approve: true }));
      await run("hrA", (c, x) => api.sendOffer(c, x, o3.id));
      await sql(`UPDATE tenant.hr_offers SET valid_until = current_date - 1 WHERE id=$1`, [o3.id]);
      const listed = await run("hrA", (c, x) => api.listOffers(c, x, {}));
      assert.equal(listed.find((o) => o.id === o3.id).status, "expired");
      await denied("hrA", (c, x) => api.recordOfferDecision(c, x, o3.id, { accepted: true }), 409, "HR_OFFER_STATE");
    });

    await t.test("F402: the accepted offer becomes an employee exactly once; the application, candidate and opening are updated", async () => {
      const r = await run("hrA", (c, x) => api.convertOfferToEmployee(c, x, ids.offer, { workEmail: "nila@co.test" }));
      assert.match(r.employee.employee_number, /^EMP-\d+/);
      const [emp] = await sql(`SELECT first_name, last_name, status, department_id, designation_id, joining_date::text AS joining_date, employment_type, manager_employee_id, personal_email FROM tenant.hr_employees WHERE id=$1`, [r.employee.id]);
      assert.equal(emp.first_name, "Nila");
      assert.equal(emp.status, "draft", "the employee starts as a pre-joining record");
      assert.equal(emp.department_id, dept.id);
      assert.equal(emp.designation_id, desig.id);
      assert.equal(emp.manager_employee_id, ids.manager, "the hiring manager becomes the reporting manager");
      assert.equal(emp.personal_email, "nila@mail.test");
      assert.equal(emp.joining_date, soon(30));
      assert.equal((await sql(`SELECT stage FROM tenant.hr_applications WHERE id=$1`, [ids.app]))[0].stage, "hired");
      assert.equal((await sql(`SELECT status FROM tenant.hr_candidates WHERE id=$1`, [ids.cand]))[0].status, "hired");
      const [o] = await sql(`SELECT filled, status FROM tenant.hr_job_openings WHERE id=$1`, [ids.opening]);
      assert.equal(o.filled, 1);
      assert.equal(o.status, "open", "one of two positions remains");
      await denied("hrA", (c, x) => api.convertOfferToEmployee(c, x, ids.offer), 409, "HR_OFFER_ALREADY_CONVERTED");
      const pipe = await run("hrA", (c, x) => api.getRecruitmentPipeline(c, x));
      assert.equal(pipe.stages.hired, 1);
      // the new employee can complete joining like any other
      const joined = await run("hrA", (c, x) => api.completeJoining(c, x, r.employee.id));
      assert.equal(joined.status, "active");
    });

    await t.test("F397: closing an opening needs a reason; cancelling one with live applications is refused", async () => {
      await denied("hrA", (c, x) => api.setOpeningStatus(c, x, ids.opening, { action: "cancel", reason: "x" }), 409);
      await denied("hrA", (c, x) => api.setOpeningStatus(c, x, ids.opening, { action: "close" }), 400, "HR_REASON_REQUIRED");
      await run("hrA", (c, x) => api.setOpeningStatus(c, x, ids.opening, { action: "hold", reason: "Budget review" }));
      await denied("hrA", (c, x) => api.applyToOpening(c, x, { openingId: ids.opening, candidateId: ids.cand2 }), 409, "HR_OPENING_STATE");
      await run("hrA", (c, x) => api.setOpeningStatus(c, x, ids.opening, { action: "resume" }));
      const closed = await run("hrA", (c, x) => api.setOpeningStatus(c, x, ids.opening, { action: "close", reason: "Hired enough" }));
      assert.equal(closed.status, "closed");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
