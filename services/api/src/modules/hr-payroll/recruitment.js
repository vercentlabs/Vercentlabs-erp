// F397-F402: job openings, candidates, the recruitment pipeline, interviews and feedback, offers,
// and conversion of an accepted offer into an employee record.
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import {
  HrError, canSeeSensitive, dateOrNull, dateRequired, has, hasAny, need, needAny, nonNegative, oneOf, ownEmployee, positive, qx, recordEvent, seq, text, textOrNull, today, uuid, uuidOrNull,
} from "./common.js";
import { saveEmployee } from "./workforce.js";

const EMPLOYMENT_TYPES = ["permanent", "contract", "intern", "consultant", "part_time", "temporary"];
const SOURCES = ["referral", "portal", "agency", "campus", "social", "walk_in", "other"];
const STAGE_FLOW = ["applied", "screening", "interview", "offer"];
const VIEW = ["hr_payroll.employee.view", "hr_payroll.employee.manage"];
const CTC_FIELDS = ["current_ctc", "expected_ctc"];
const stripCtc = (row, c) => {
  if (!row || canSeeSensitive(c)) return row;
  const clone = { ...row };
  for (const f of CTC_FIELDS) delete clone[f];
  return clone;
};

// ---------------------------------------------------------------- job openings (F397)
async function loadOpening(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_job_openings WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Job opening")]);
  if (!rows[0]) throw new HrError(404, "Job opening was not found.", "HR_OPENING_NOT_FOUND");
  return rows[0];
}

export async function listJobOpenings(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra = ` AND o.status=$3`; }
  const { rows } = await qx(
    client,
    `SELECT o.*, d.name AS department_name, g.name AS designation_name, trim(m.first_name || ' ' || m.last_name) AS hiring_manager_name,
       (SELECT count(*) FROM tenant.hr_applications a WHERE a.opening_id=o.id AND a.stage NOT IN ('rejected','withdrawn'))::int AS active_applications
     FROM tenant.hr_job_openings o LEFT JOIN tenant.hr_departments d ON d.id=o.department_id LEFT JOIN tenant.hr_designations g ON g.id=o.designation_id LEFT JOIN tenant.hr_employees m ON m.id=o.hiring_manager_employee_id
     WHERE o.organization_id=$1 AND o.company_id=$2${extra} ORDER BY o.created_at DESC LIMIT 500`,
    params,
  );
  return rows.map((r) => (canSeeSensitive(c) ? r : { ...r, salary_min: undefined, salary_max: undefined }));
}

async function refCheck(client, c, { departmentId, designationId, hiringManagerId }) {
  if (departmentId && !(await qx(client, `SELECT 1 FROM tenant.hr_departments WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, departmentId])).rows[0]) throw new HrError(400, "Department was not found or is inactive.", "HR_DEPARTMENT_NOT_FOUND");
  if (designationId && !(await qx(client, `SELECT 1 FROM tenant.hr_designations WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, designationId])).rows[0]) throw new HrError(400, "Designation was not found or is inactive.", "HR_DESIGNATION_NOT_FOUND");
  if (hiringManagerId && !(await qx(client, `SELECT 1 FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('active','on_leave','on_notice')`, [c.organizationId, c.companyId, hiringManagerId])).rows[0]) throw new HrError(400, "The hiring manager must be a current employee.", "HR_MANAGER_INVALID");
}

export async function saveJobOpening(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const title = text(input.title, 200);
  if (!title) throw new HrError(400, "A job opening needs a title.", "HR_OPENING_INVALID");
  const positions = Math.trunc(positive(input.positions ?? 1, "Positions"));
  const min = input.salaryMin === undefined || input.salaryMin === "" ? null : nonNegative(input.salaryMin, "Minimum salary");
  const max = input.salaryMax === undefined || input.salaryMax === "" ? null : nonNegative(input.salaryMax, "Maximum salary");
  if (min !== null && max !== null && max < min) throw new HrError(400, "The maximum salary is below the minimum.", "HR_OPENING_INVALID");
  if ((min !== null || max !== null) && !canSeeSensitive(c)) throw new HrError(403, "Setting a salary range needs the sensitive-data permission.", "HR_SENSITIVE_FORBIDDEN");
  const departmentId = uuidOrNull(input.departmentId, "Department");
  const designationId = uuidOrNull(input.designationId, "Designation");
  const hiringManagerId = uuidOrNull(input.hiringManagerEmployeeId, "Hiring manager");
  await refCheck(client, c, { departmentId, designationId, hiringManagerId });
  const type = oneOf(String(input.employmentType ?? "permanent"), EMPLOYMENT_TYPES, "Employment type");
  const target = dateOrNull(input.targetCloseDate, "Target close date");
  if (target && target < today()) throw new HrError(400, "The target close date is in the past.", "HR_OPENING_INVALID");
  if (input.id) {
    const o = await loadOpening(client, c, input.id, true);
    if (!["draft", "pending_approval", "open", "on_hold"].includes(o.status)) throw new HrError(409, "A closed opening cannot be edited.", "HR_OPENING_STATE");
    if (positions < o.filled) throw new HrError(400, `${o.filled} position(s) are already filled.`, "HR_OPENING_INVALID");
    const { rows } = await qx(client,
      `UPDATE tenant.hr_job_openings SET title=$3, department_id=$4, designation_id=$5, hiring_manager_employee_id=$6, employment_type=$7, location=$8, positions=$9, description=$10, requirements=$11,
         salary_min=$12, salary_max=$13, target_close_date=$14, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [c.organizationId, o.id, title, departmentId, designationId, hiringManagerId, type, textOrNull(input.location, 200), positions, textOrNull(input.description, 5000), textOrNull(input.requirements, 5000), min ?? o.salary_min, max ?? o.salary_max, target]);
    await recordEvent(client, c, "job_opening", o.id, "hr.opening.updated", {});
    return rows[0];
  }
  const number = await nextDocumentNumber(client, c, { documentType: "hr_job_opening", prefix: "JOB", padding: 5 });
  const { rows } = await qx(client,
    `INSERT INTO tenant.hr_job_openings(organization_id,company_id,opening_number,title,department_id,designation_id,hiring_manager_employee_id,employment_type,location,positions,description,requirements,salary_min,salary_max,target_close_date,requested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [c.organizationId, c.companyId, number, title, departmentId, designationId, hiringManagerId, type, textOrNull(input.location, 200), positions, textOrNull(input.description, 5000), textOrNull(input.requirements, 5000), min, max, target, c.userId]);
  await recordEvent(client, c, "job_opening", rows[0].id, "hr.opening.created", { number });
  return rows[0];
}

export async function submitJobOpening(client, c, id) {
  need(c, "hr_payroll.employee.manage");
  const o = await loadOpening(client, c, id, true);
  if (o.status !== "draft") throw new HrError(409, "Only a draft opening can be submitted.", "HR_OPENING_STATE");
  const { rows } = await qx(client, `UPDATE tenant.hr_job_openings SET status='pending_approval', updated_at=now() WHERE id=$1 RETURNING *`, [o.id]);
  await recordEvent(client, c, "job_opening", o.id, "hr.opening.submitted", {});
  return rows[0];
}
export async function decideJobOpening(client, c, id, { approve, note }) {
  need(c, "hr_payroll.employee.manage");
  const o = await loadOpening(client, c, id, true);
  if (o.status !== "pending_approval") throw new HrError(409, "Only an opening awaiting approval can be decided.", "HR_OPENING_STATE");
  if (o.requested_by === c.userId) throw new HrError(403, "An opening must be approved by someone other than the person who requested it.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for sending the opening back.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client,
    approve
      ? `UPDATE tenant.hr_job_openings SET status='open', approved_by=$2, approved_at=now(), opened_at=now(), updated_at=now() WHERE id=$1 RETURNING *`
      : `UPDATE tenant.hr_job_openings SET status='draft', close_reason=$3, updated_at=now() WHERE id=$1 AND $2::uuid IS NOT NULL RETURNING *`,
    approve ? [o.id, c.userId] : [o.id, c.userId, text(note)]);
  await recordEvent(client, c, "job_opening", o.id, approve ? "hr.opening.approved" : "hr.opening.returned", { note: textOrNull(note) });
  return rows[0];
}
export async function setOpeningStatus(client, c, id, { action, reason }) {
  need(c, "hr_payroll.employee.manage");
  const o = await loadOpening(client, c, id, true);
  const allowed = { hold: ["open"], resume: ["on_hold"], close: ["open", "on_hold"], cancel: ["draft", "pending_approval", "open", "on_hold"] };
  oneOf(action, Object.keys(allowed), "Action");
  if (!allowed[action].includes(o.status)) throw new HrError(409, `A ${o.status.replace("_", " ")} opening cannot be ${action === "hold" ? "put on hold" : action === "resume" ? "resumed" : `${action}d`}.`, "HR_OPENING_STATE");
  if (["close", "cancel", "hold"].includes(action) && !text(reason)) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  if (action === "cancel") {
    const live = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_applications WHERE opening_id=$1 AND stage IN ('applied','screening','interview','offer')`, [o.id]);
    if (live.rows[0].n > 0) throw new HrError(409, `${live.rows[0].n} live application(s) must be rejected or moved first.`, "HR_OPENING_HAS_APPLICATIONS");
  }
  const status = { hold: "on_hold", resume: "open", close: "closed", cancel: "cancelled" }[action];
  const { rows } = await qx(client, `UPDATE tenant.hr_job_openings SET status=$2, close_reason=$3, closed_at=CASE WHEN $2 IN ('closed','cancelled') THEN now() ELSE closed_at END, updated_at=now() WHERE id=$1 RETURNING *`, [o.id, status, textOrNull(reason)]);
  await recordEvent(client, c, "job_opening", o.id, `hr.opening.${action}`, { reason: textOrNull(reason) });
  return rows[0];
}

// ---------------------------------------------------------------- candidates (F398)
async function loadCandidate(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_candidates WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Candidate")]);
  if (!rows[0]) throw new HrError(404, "Candidate was not found.", "HR_CANDIDATE_NOT_FOUND");
  return rows[0];
}
export async function listCandidates(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND s.status=$${params.length}`; }
  if (filters.source) { params.push(String(filters.source)); extra += ` AND s.source=$${params.length}`; }
  const { rows } = await qx(client, `SELECT s.*, trim(s.first_name || ' ' || s.last_name) AS full_name, (SELECT count(*) FROM tenant.hr_applications a WHERE a.candidate_id=s.id)::int AS applications FROM tenant.hr_candidates s WHERE s.organization_id=$1 AND s.company_id=$2${extra} ORDER BY s.created_at DESC LIMIT 1000`, params);
  return rows.map((r) => stripCtc(r, c));
}
export async function saveCandidate(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const first = text(input.firstName, 80);
  const last = text(input.lastName, 80);
  const email = text(input.email, 200).toLowerCase();
  if (!first || !last) throw new HrError(400, "First and last name are required.", "HR_CANDIDATE_INVALID");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HrError(400, "A valid email address is required.", "HR_EMAIL_INVALID");
  const phone = text(input.phone, 20);
  if (phone && !/^[+\d][\d\s-]{6,18}$/.test(phone)) throw new HrError(400, "Phone number is not valid.", "HR_PHONE_INVALID");
  const source = oneOf(String(input.source ?? "other"), SOURCES, "Source");
  const referrer = uuidOrNull(input.referredByEmployeeId, "Referrer");
  if (source === "referral" && !referrer) throw new HrError(400, "Say which employee referred the candidate.", "HR_CANDIDATE_INVALID");
  const experience = input.experienceYears === undefined || input.experienceYears === "" ? null : nonNegative(input.experienceYears, "Experience");
  const wantsCtc = ["currentCtc", "expectedCtc"].some((k) => input[k] !== undefined && input[k] !== "");
  if (wantsCtc && !canSeeSensitive(c)) throw new HrError(403, "Recording compensation needs the sensitive-data permission.", "HR_SENSITIVE_FORBIDDEN");
  const skills = Array.isArray(input.skills) ? input.skills.map((s) => text(s, 60)).filter(Boolean).slice(0, 40) : typeof input.skills === "string" ? input.skills.split(",").map((s) => text(s, 60)).filter(Boolean).slice(0, 40) : undefined;
  const vals = [first, last, email, textOrNull(phone, 20), source, referrer, textOrNull(input.currentEmployer, 200), textOrNull(input.currentTitle, 200), experience,
    input.currentCtc === undefined || input.currentCtc === "" ? null : nonNegative(input.currentCtc, "Current CTC"), input.expectedCtc === undefined || input.expectedCtc === "" ? null : nonNegative(input.expectedCtc, "Expected CTC"),
    input.noticePeriodDays === undefined || input.noticePeriodDays === "" ? null : Math.trunc(nonNegative(input.noticePeriodDays, "Notice period")), textOrNull(input.resumeReference, 500), textOrNull(input.notes, 2000)];
  // checked up front: a unique-violation would abort the whole transaction
  const dup = await qx(client, `SELECT candidate_number FROM tenant.hr_candidates WHERE organization_id=$1 AND lower(email)=$2 AND ($3::uuid IS NULL OR id <> $3::uuid)`, [c.organizationId, email, uuidOrNull(input.id, "Candidate")]);
  if (dup.rows[0]) throw new HrError(409, `A candidate with that email already exists (${dup.rows[0].candidate_number}).`, "HR_CANDIDATE_DUPLICATE");
  {
    if (input.id) {
      const cand = await loadCandidate(client, c, input.id, true);
      const { rows } = await qx(client,
        `UPDATE tenant.hr_candidates SET first_name=$3,last_name=$4,email=$5,phone=$6,source=$7,referred_by_employee_id=$8,current_employer=$9,current_title=$10,experience_years=$11,
           current_ctc=coalesce($12,current_ctc),expected_ctc=coalesce($13,expected_ctc),notice_period_days=$14,resume_reference=$15,notes=$16,skills=coalesce($17::text[],skills),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [c.organizationId, cand.id, ...vals, skills ?? null]);
      return stripCtc(rows[0], c);
    }
    const number = await nextDocumentNumber(client, c, { documentType: "hr_candidate", prefix: "CAN", padding: 5 });
    const { rows } = await qx(client,
      `INSERT INTO tenant.hr_candidates(organization_id,company_id,candidate_number,first_name,last_name,email,phone,source,referred_by_employee_id,current_employer,current_title,experience_years,current_ctc,expected_ctc,notice_period_days,resume_reference,notes,skills,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::text[],$19) RETURNING *`,
      [c.organizationId, c.companyId, number, ...vals, skills ?? [], c.userId]);
    await recordEvent(client, c, "candidate", rows[0].id, "hr.candidate.created", { number });
    return stripCtc(rows[0], c);
  }
}

// ---------------------------------------------------------------- applications and pipeline (F399)
async function loadApplication(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_applications WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Application")]);
  if (!rows[0]) throw new HrError(404, "Application was not found.", "HR_APPLICATION_NOT_FOUND");
  return rows[0];
}
export async function applyToOpening(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const o = await loadOpening(client, c, input.openingId, true);
  if (o.status !== "open") throw new HrError(409, "Applications are accepted only while the opening is open.", "HR_OPENING_STATE");
  const cand = await loadCandidate(client, c, input.candidateId);
  if (["hired", "withdrawn"].includes(cand.status)) throw new HrError(409, `A ${cand.status} candidate cannot apply.`, "HR_CANDIDATE_STATE");
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.hr_applications(organization_id,company_id,opening_id,candidate_id,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [c.organizationId, c.companyId, o.id, cand.id, c.userId]);
    if (cand.status === "rejected") await qx(client, `UPDATE tenant.hr_candidates SET status='active', updated_at=now() WHERE id=$1`, [cand.id]);
    await recordEvent(client, c, "application", rows[0].id, "hr.application.created", { opening: o.opening_number, candidate: cand.candidate_number });
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, "This candidate has already applied to this opening.", "HR_APPLICATION_DUPLICATE");
    throw e;
  }
}

export async function listApplications(client, c, filters = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.openingId) { params.push(uuid(filters.openingId, "Opening")); extra += ` AND a.opening_id=$${params.length}`; }
  if (filters.stage) { params.push(String(filters.stage)); extra += ` AND a.stage=$${params.length}`; }
  const { rows } = await qx(client,
    `SELECT a.*, trim(s.first_name || ' ' || s.last_name) AS candidate_name, s.candidate_number, s.email, o.opening_number, o.title AS opening_title,
       (SELECT count(*) FROM tenant.hr_interviews i WHERE i.application_id=a.id AND i.status='completed')::int AS interviews_done,
       (SELECT round(avg(rating)::numeric,2) FROM tenant.hr_interviews i WHERE i.application_id=a.id AND i.status='completed') AS average_rating
     FROM tenant.hr_applications a JOIN tenant.hr_candidates s ON s.id=a.candidate_id JOIN tenant.hr_job_openings o ON o.id=a.opening_id
     WHERE a.organization_id=$1 AND a.company_id=$2${extra} ORDER BY a.stage_changed_at DESC LIMIT 1000`, params);
  return rows;
}

export async function moveApplication(client, c, id, { stage, reason }) {
  need(c, "hr_payroll.employee.manage");
  const a = await loadApplication(client, c, id, true);
  const target = oneOf(String(stage), [...STAGE_FLOW, "rejected", "withdrawn"], "Stage");
  if (["hired", "rejected", "withdrawn"].includes(a.stage)) throw new HrError(409, `A ${a.stage} application cannot move.`, "HR_APPLICATION_STATE");
  if (["rejected", "withdrawn"].includes(target)) {
    if (!text(reason)) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
    const openOffer = await qx(client, `SELECT 1 FROM tenant.hr_offers WHERE application_id=$1 AND status IN ('draft','pending_approval','approved','sent','accepted')`, [a.id]);
    if (openOffer.rows[0]) throw new HrError(409, "Withdraw the open offer first.", "HR_APPLICATION_HAS_OFFER");
    await qx(client, `UPDATE tenant.hr_interviews SET status='cancelled', cancel_reason='Application ' || $2 WHERE application_id=$1 AND status='scheduled'`, [a.id, target]);
  } else {
    if (STAGE_FLOW.indexOf(target) !== STAGE_FLOW.indexOf(a.stage) + 1) throw new HrError(409, `An application moves one stage at a time: ${STAGE_FLOW.join(" → ")}.`, "HR_APPLICATION_STAGE");
    if (target === "offer") {
      const done = await qx(client, `SELECT count(*)::int AS n, bool_or(recommendation IN ('no','strong_no')) AS negative FROM tenant.hr_interviews WHERE application_id=$1 AND status='completed'`, [a.id]);
      if (done.rows[0].n === 0) throw new HrError(409, "At least one interview with feedback is needed before an offer.", "HR_NO_INTERVIEW_FEEDBACK");
    }
  }
  const { rows } = await qx(client, `UPDATE tenant.hr_applications SET stage=$2, stage_changed_at=now(), reason=$3 WHERE id=$1 RETURNING *`, [a.id, target, textOrNull(reason)]);
  if (target === "rejected") {
    const left = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_applications WHERE candidate_id=$1 AND stage IN ('applied','screening','interview','offer','hired')`, [a.candidate_id]);
    if (left.rows[0].n === 0) await qx(client, `UPDATE tenant.hr_candidates SET status='rejected', updated_at=now() WHERE id=$1 AND status='active'`, [a.candidate_id]);
  }
  await recordEvent(client, c, "application", a.id, `hr.application.${target}`, { from: a.stage, reason: textOrNull(reason) });
  return rows[0];
}

export async function getRecruitmentPipeline(client, c, { openingId } = {}) {
  needAny(c, VIEW);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (openingId) { params.push(uuid(openingId, "Opening")); extra = ` AND opening_id=$3`; }
  const { rows } = await qx(client, `SELECT stage, count(*)::int AS n FROM tenant.hr_applications WHERE organization_id=$1 AND company_id=$2${extra} GROUP BY stage`, params);
  const counts = Object.fromEntries(rows.map((r) => [r.stage, r.n]));
  const [openings, offers, timeToFill] = await seq([
    () => qx(client, `SELECT status, count(*)::int AS n FROM tenant.hr_job_openings WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT status, count(*)::int AS n FROM tenant.hr_offers WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT round(avg(extract(epoch FROM (a.stage_changed_at - a.created_at)) / 86400)::numeric, 1) AS days FROM tenant.hr_applications a WHERE a.organization_id=$1 AND a.company_id=$2 AND a.stage='hired'`, [c.organizationId, c.companyId]),
  ]);
  return { stages: Object.fromEntries([...STAGE_FLOW, "hired", "rejected", "withdrawn"].map((s) => [s, counts[s] ?? 0])), openings: Object.fromEntries(openings.rows.map((r) => [r.status, r.n])), offers: Object.fromEntries(offers.rows.map((r) => [r.status, r.n])), averageDaysToHire: timeToFill.rows[0].days === null ? null : Number(timeToFill.rows[0].days) };
}

// ---------------------------------------------------------------- interviews (F400)
export async function listInterviews(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.applicationId) { params.push(uuid(filters.applicationId, "Application")); extra += ` AND i.application_id=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND i.status=$${params.length}`; }
  if (filters.mine === true || !hasAny(c, VIEW)) {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra += ` AND i.interviewer_employee_id=$${params.length}`;
  }
  const { rows } = await qx(client,
    `SELECT i.*, trim(s.first_name || ' ' || s.last_name) AS candidate_name, s.candidate_number, o.title AS opening_title, trim(e.first_name || ' ' || e.last_name) AS interviewer_name
     FROM tenant.hr_interviews i JOIN tenant.hr_applications a ON a.id=i.application_id JOIN tenant.hr_candidates s ON s.id=a.candidate_id JOIN tenant.hr_job_openings o ON o.id=a.opening_id JOIN tenant.hr_employees e ON e.id=i.interviewer_employee_id
     WHERE i.organization_id=$1 AND i.company_id=$2${extra} ORDER BY i.scheduled_at DESC LIMIT 500`, params);
  return rows;
}
export async function scheduleInterview(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const a = await loadApplication(client, c, input.applicationId, true);
  if (!["screening", "interview"].includes(a.stage)) throw new HrError(409, "Interviews are scheduled once the application is in screening or interview.", "HR_APPLICATION_STAGE");
  const when = new Date(String(input.scheduledAt ?? ""));
  if (Number.isNaN(when.getTime())) throw new HrError(400, "Give the interview date and time.", "HR_INTERVIEW_INVALID");
  if (when.getTime() < Date.now() - 5 * 60000) throw new HrError(400, "An interview cannot be scheduled in the past.", "HR_INTERVIEW_INVALID");
  const duration = Math.trunc(positive(input.durationMinutes ?? 45, "Duration"));
  const interviewer = uuid(input.interviewerEmployeeId, "Interviewer");
  const emp = await qx(client, `SELECT id FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('active','on_leave','on_notice')`, [c.organizationId, c.companyId, interviewer]);
  if (!emp.rows[0]) throw new HrError(400, "The interviewer must be a current employee.", "HR_INTERVIEWER_INVALID");
  const clash = await qx(client,
    `SELECT 1 FROM tenant.hr_interviews WHERE organization_id=$1 AND interviewer_employee_id=$2 AND status='scheduled' AND scheduled_at < $3::timestamptz + ($4::int * interval '1 minute') AND scheduled_at + (duration_minutes * interval '1 minute') > $3::timestamptz`,
    [c.organizationId, interviewer, when.toISOString(), duration]);
  if (clash.rows[0]) throw new HrError(409, "The interviewer already has an interview at that time.", "HR_INTERVIEW_CONFLICT");
  const round = (await qx(client, `SELECT coalesce(max(round_number),0)+1 AS n FROM tenant.hr_interviews WHERE application_id=$1 AND status <> 'cancelled'`, [a.id])).rows[0].n;
  const type = oneOf(String(input.interviewType ?? "technical"), ["phone", "technical", "managerial", "hr", "panel"], "Interview type");
  const mode = oneOf(String(input.mode ?? "video"), ["video", "onsite", "phone"], "Mode");
  const { rows } = await qx(client,
    `INSERT INTO tenant.hr_interviews(organization_id,company_id,application_id,round_number,interview_type,interviewer_employee_id,scheduled_at,duration_minutes,mode,location,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, a.id, round, type, interviewer, when.toISOString(), duration, mode, textOrNull(input.location, 300), c.userId]);
  if (a.stage === "screening") await qx(client, `UPDATE tenant.hr_applications SET stage='interview', stage_changed_at=now() WHERE id=$1`, [a.id]);
  await recordEvent(client, c, "application", a.id, "hr.interview.scheduled", { interviewId: rows[0].id, round });
  return rows[0];
}
export async function cancelInterview(client, c, id, reason) {
  need(c, "hr_payroll.employee.manage");
  if (!text(reason)) throw new HrError(400, "Give a reason for cancelling.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_interviews SET status='cancelled', cancel_reason=$4 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='scheduled' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Interview"), text(reason)]);
  if (!rows[0]) throw new HrError(409, "Only a scheduled interview can be cancelled.", "HR_INTERVIEW_STATE");
  return rows[0];
}
export async function submitInterviewFeedback(client, c, id, input) {
  const { rows } = await qx(client, `SELECT i.*, e.user_id AS interviewer_user FROM tenant.hr_interviews i JOIN tenant.hr_employees e ON e.id=i.interviewer_employee_id WHERE i.organization_id=$1 AND i.company_id=$2 AND i.id=$3 FOR UPDATE OF i`, [c.organizationId, c.companyId, uuid(id, "Interview")]);
  const i = rows[0];
  if (!i) throw new HrError(404, "Interview was not found.", "HR_INTERVIEW_NOT_FOUND");
  // the interviewer (an ordinary employee) submits their own feedback; HR may record it on their behalf
  if (!(i.interviewer_user === c.userId || has(c, "hr_payroll.employee.manage"))) throw new HrError(403, "Only the interviewer can submit feedback for this interview.", "HR_FORBIDDEN");
  if (i.status !== "scheduled") throw new HrError(409, "Feedback is recorded once, for a scheduled interview.", "HR_INTERVIEW_STATE");
  if (new Date(i.scheduled_at).getTime() > Date.now()) throw new HrError(409, "The interview has not happened yet.", "HR_INTERVIEW_FUTURE");
  const rating = Math.trunc(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) throw new HrError(400, "Rate the candidate from 1 to 5.", "HR_FEEDBACK_INVALID");
  const recommendation = oneOf(String(input.recommendation), ["strong_yes", "yes", "no", "strong_no"], "Recommendation");
  if (!text(input.feedback)) throw new HrError(400, "Written feedback is required.", "HR_FEEDBACK_INVALID");
  const out = await qx(client, `UPDATE tenant.hr_interviews SET status='completed', rating=$2, recommendation=$3, feedback=$4, feedback_by=$5, feedback_at=now() WHERE id=$1 RETURNING *`, [i.id, rating, recommendation, text(input.feedback, 4000), c.userId]);
  await recordEvent(client, c, "application", i.application_id, "hr.interview.feedback", { interviewId: i.id, rating, recommendation });
  return out.rows[0];
}
export async function markInterviewNoShow(client, c, id) {
  need(c, "hr_payroll.employee.manage");
  const { rows } = await qx(client, `UPDATE tenant.hr_interviews SET status='no_show' WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='scheduled' AND scheduled_at <= now() RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Interview")]);
  if (!rows[0]) throw new HrError(409, "Only a past, scheduled interview can be marked as a no-show.", "HR_INTERVIEW_STATE");
  return rows[0];
}

// ---------------------------------------------------------------- offers (F401)
async function loadOffer(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_offers WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Offer")]);
  if (!rows[0]) throw new HrError(404, "Offer was not found.", "HR_OFFER_NOT_FOUND");
  return rows[0];
}
const needOfferRights = (c) => { need(c, "hr_payroll.employee.manage"); need(c, "hr_payroll.compensation.manage"); };

export async function listOffers(client, c, filters = {}) {
  needAny(c, ["hr_payroll.compensation.manage", "hr_payroll.sensitive.view"]);
  await qx(client, `UPDATE tenant.hr_offers SET status='expired', decided_at=now() WHERE organization_id=$1 AND company_id=$2 AND status='sent' AND valid_until < current_date`, [c.organizationId, c.companyId]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra = ` AND f.status=$3`; }
  const { rows } = await qx(client,
    `SELECT f.*, trim(s.first_name || ' ' || s.last_name) AS candidate_name, s.candidate_number, o.title AS opening_title, o.opening_number, d.name AS designation_name, emp.employee_number
     FROM tenant.hr_offers f JOIN tenant.hr_applications a ON a.id=f.application_id JOIN tenant.hr_candidates s ON s.id=a.candidate_id JOIN tenant.hr_job_openings o ON o.id=a.opening_id
     LEFT JOIN tenant.hr_designations d ON d.id=f.designation_id LEFT JOIN tenant.hr_employees emp ON emp.id=f.employee_id
     WHERE f.organization_id=$1 AND f.company_id=$2${extra} ORDER BY f.created_at DESC LIMIT 500`, params);
  return rows;
}
export async function createOffer(client, c, input) {
  needOfferRights(c);
  const a = await loadApplication(client, c, input.applicationId, true);
  if (a.stage !== "offer") throw new HrError(409, "An offer is made once the application reaches the offer stage.", "HR_APPLICATION_STAGE");
  const o = await loadOpening(client, c, a.opening_id);
  const ctc = positive(input.annualCtc, "Annual CTC");
  const joining = dateRequired(input.joiningDate, "Joining date");
  const validUntil = dateRequired(input.validUntil, "Offer valid until");
  if (validUntil < today()) throw new HrError(400, "The offer would already be expired.", "HR_OFFER_INVALID");
  if (joining < validUntil && joining < today()) throw new HrError(400, "The joining date is in the past.", "HR_OFFER_INVALID");
  let terms = textOrNull(input.terms, 3000);
  // The opening form starts its salary fields at 0, so a band left untouched is stored as 0 to 0. A bound of zero means
  // "no bound was set", otherwise every offer for such an opening would need a justification.
  const bandMin = o.salary_min !== null && Number(o.salary_min) > 0 ? Number(o.salary_min) : null;
  const bandMax = o.salary_max !== null && Number(o.salary_max) > 0 ? Number(o.salary_max) : null;
  const outside = (bandMin !== null && ctc < bandMin) || (bandMax !== null && ctc > bandMax);
  if (outside) {
    if (!text(input.justification)) throw new HrError(409, `The offer is outside the approved range (${bandMin ?? "no minimum"} to ${bandMax ?? "no maximum"}). Give a justification to continue.`, "HR_OFFER_OUTSIDE_RANGE");
    terms = `[Range exception: ${text(input.justification, 500)}] ${terms ?? ""}`.trim();
  }
  const departmentId = uuidOrNull(input.departmentId, "Department") ?? o.department_id;
  const designationId = uuidOrNull(input.designationId, "Designation") ?? o.designation_id;
  await refCheck(client, c, { departmentId, designationId });
  const number = await nextDocumentNumber(client, c, { documentType: "hr_offer", prefix: "OFR", padding: 5 });
  try {
    const { rows } = await qx(client,
      `INSERT INTO tenant.hr_offers(organization_id,company_id,offer_number,application_id,designation_id,department_id,employment_type,annual_ctc,joining_date,valid_until,terms,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [c.organizationId, c.companyId, number, a.id, designationId, departmentId, oneOf(String(input.employmentType ?? o.employment_type), EMPLOYMENT_TYPES, "Employment type"), ctc, joining, validUntil, terms, c.userId]);
    await recordEvent(client, c, "offer", rows[0].id, "hr.offer.created", { number, outside });
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, "There is already an open offer for this application.", "HR_OFFER_OPEN");
    throw e;
  }
}
export async function submitOffer(client, c, id) {
  needOfferRights(c);
  const f = await loadOffer(client, c, id, true);
  if (f.status !== "draft") throw new HrError(409, "Only a draft offer can be submitted.", "HR_OFFER_STATE");
  const { rows } = await qx(client, `UPDATE tenant.hr_offers SET status='pending_approval' WHERE id=$1 RETURNING *`, [f.id]);
  return rows[0];
}
export async function decideOffer(client, c, id, { approve, note }) {
  needOfferRights(c);
  const f = await loadOffer(client, c, id, true);
  if (f.status !== "pending_approval") throw new HrError(409, "Only an offer awaiting approval can be decided.", "HR_OFFER_STATE");
  if (f.created_by === c.userId) throw new HrError(403, "An offer must be approved by someone other than the person who prepared it.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for sending the offer back.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, approve
    ? `UPDATE tenant.hr_offers SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *`
    : `UPDATE tenant.hr_offers SET status='draft', decision_note=$3 WHERE id=$1 AND $2::uuid IS NOT NULL RETURNING *`, approve ? [f.id, c.userId] : [f.id, c.userId, text(note)]);
  await recordEvent(client, c, "offer", f.id, approve ? "hr.offer.approved" : "hr.offer.returned", {});
  return rows[0];
}
export async function sendOffer(client, c, id) {
  needOfferRights(c);
  const f = await loadOffer(client, c, id, true);
  if (f.status !== "approved") throw new HrError(409, "Only an approved offer can be sent.", "HR_OFFER_STATE");
  if (String(f.valid_until) < today()) throw new HrError(409, "The offer has expired.", "HR_OFFER_EXPIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_offers SET status='sent', sent_at=now() WHERE id=$1 RETURNING *`, [f.id]);
  await recordEvent(client, c, "offer", f.id, "hr.offer.sent", {});
  return rows[0];
}
export async function recordOfferDecision(client, c, id, { accepted, note }) {
  needOfferRights(c);
  const f = await loadOffer(client, c, id, true);
  if (f.status !== "sent") throw new HrError(409, "Only a sent offer can be accepted or declined.", "HR_OFFER_STATE");
  if (String(f.valid_until) < today()) {
    await qx(client, `UPDATE tenant.hr_offers SET status='expired', decided_at=now() WHERE id=$1`, [f.id]);
    throw new HrError(409, "The offer expired before the decision.", "HR_OFFER_EXPIRED");
  }
  if (!accepted && !text(note)) throw new HrError(400, "Record why the candidate declined.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_offers SET status=$2, decided_at=now(), decision_note=$3 WHERE id=$1 RETURNING *`, [f.id, accepted ? "accepted" : "declined", textOrNull(note)]);
  if (!accepted) await qx(client, `UPDATE tenant.hr_applications SET stage='rejected', stage_changed_at=now(), reason='Offer declined' WHERE id=$1`, [f.application_id]);
  await recordEvent(client, c, "offer", f.id, accepted ? "hr.offer.accepted" : "hr.offer.declined", {});
  return rows[0];
}
export async function withdrawOffer(client, c, id, reason) {
  needOfferRights(c);
  if (!text(reason)) throw new HrError(400, "Give a reason for withdrawing the offer.", "HR_REASON_REQUIRED");
  const f = await loadOffer(client, c, id, true);
  if (!["draft", "pending_approval", "approved", "sent"].includes(f.status)) throw new HrError(409, "That offer can no longer be withdrawn.", "HR_OFFER_STATE");
  const { rows } = await qx(client, `UPDATE tenant.hr_offers SET status='withdrawn', decided_at=now(), decision_note=$2 WHERE id=$1 RETURNING *`, [f.id, text(reason)]);
  await recordEvent(client, c, "offer", f.id, "hr.offer.withdrawn", {});
  return rows[0];
}

// ---------------------------------------------------------------- candidate to employee (F402)
export async function convertOfferToEmployee(client, c, offerId, input = {}) {
  needOfferRights(c);
  const f = await loadOffer(client, c, offerId, true);
  if (f.employee_id) {
    const e = await qx(client, `SELECT id, employee_number FROM tenant.hr_employees WHERE id=$1`, [f.employee_id]);
    throw new HrError(409, `This offer was already converted to employee ${e.rows[0]?.employee_number}.`, "HR_OFFER_ALREADY_CONVERTED");
  }
  if (f.status !== "accepted") throw new HrError(409, "Only an accepted offer can be converted to an employee.", "HR_OFFER_STATE");
  const a = await loadApplication(client, c, f.application_id, true);
  const cand = await loadCandidate(client, c, a.candidate_id, true);
  const o = await loadOpening(client, c, a.opening_id, true);
  if (o.filled >= o.positions) throw new HrError(409, "All positions on this opening are already filled.", "HR_OPENING_FULL");
  const employee = await saveEmployee(client, c, {
    firstName: cand.first_name, lastName: cand.last_name, workEmail: input.workEmail || undefined, personalEmail: cand.email, personalPhone: cand.phone || undefined,
    employmentType: f.employment_type, joiningDate: String(f.joining_date), departmentId: f.department_id || undefined, designationId: f.designation_id || undefined,
    managerEmployeeId: input.managerEmployeeId || o.hiring_manager_employee_id || undefined, branchId: input.branchId || undefined, workLocation: o.location || undefined,
    noticePeriodDays: cand.notice_period_days ?? undefined,
  });
  await qx(client, `UPDATE tenant.hr_offers SET employee_id=$2 WHERE id=$1`, [f.id, employee.id]);
  await qx(client, `UPDATE tenant.hr_applications SET stage='hired', stage_changed_at=now() WHERE id=$1`, [a.id]);
  await qx(client, `UPDATE tenant.hr_candidates SET status='hired', updated_at=now() WHERE id=$1`, [cand.id]);
  const filled = o.filled + 1;
  await qx(client, `UPDATE tenant.hr_job_openings SET filled=$2, status=CASE WHEN $2 >= positions THEN 'closed' ELSE status END, closed_at=CASE WHEN $2 >= positions THEN now() ELSE closed_at END, close_reason=CASE WHEN $2 >= positions THEN 'All positions filled' ELSE close_reason END, updated_at=now() WHERE id=$1`, [o.id, filled]);
  // other live applications of this candidate are closed: they took this job
  await qx(client, `UPDATE tenant.hr_applications SET stage='withdrawn', stage_changed_at=now(), reason='Candidate hired elsewhere in the company' WHERE candidate_id=$1 AND id <> $2 AND stage IN ('applied','screening','interview','offer')`, [cand.id, a.id]);
  await recordEvent(client, c, "employee", employee.id, "hr.candidate.converted", { offerId: f.id, candidate: cand.candidate_number, ctc: Number(f.annual_ctc) });
  return { employee: { id: employee.id, employee_number: employee.employee_number }, offerId: f.id, annualCtc: f.annual_ctc };
}
