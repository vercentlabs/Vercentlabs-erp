// F448-F452: goals (with a parent for alignment, and check-ins), a review-cycle appraisal with
// self, manager and optional peer input calibrated to a final rating, a skills registry with
// employee proficiency, and training (courses, sessions, enrolment and completion).
import {
  HrError, dateOrNull, dateRequired, has, need, needAny, nonNegative, oneOf, ownEmployee, positive, qx, recordEvent, round2, seq, text, textOrNull, today, uuid, uuidOrNull,
} from "./common.js";

const MANAGE = "hr_payroll.employee.manage";
const VIEW = [MANAGE, "hr_payroll.reports.view"];
const NAME = `trim(e.first_name || ' ' || e.last_name)`;

async function loadEmployee(client, c, id) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
// Self, the reporting manager, or someone with the employee-management permission.
async function actorFor(client, c, employeeId, { allowManager = true } = {}) {
  const employee = await loadEmployee(client, c, employeeId);
  const own = await ownEmployee(client, c);
  const isSelf = Boolean(own && own.id === employee.id);
  const isManager = allowManager && Boolean(own && employee.manager_employee_id === own.id);
  const isHr = has(c, MANAGE);
  return { employee, own, isSelf, isManager, isHr };
}

// ---------------------------------------------------------------- goals (F448)
export async function listGoals(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND g.status=$${params.length}`; }
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND g.employee_id=$${params.length}`;
  } else if (filters.scope === "team") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND e.manager_employee_id=$${params.length}`;
  } else needAny(c, VIEW);
  if (filters.employeeId && filters.scope !== "mine") { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND g.employee_id=$${params.length}`; }
  const { rows } = await qx(client, `SELECT g.*, e.employee_number, ${NAME} AS employee_name, p.title AS parent_title,
      (SELECT count(*) FROM tenant.hr_goal_checkins ci WHERE ci.goal_id=g.id)::int AS checkins
    FROM tenant.hr_goals g JOIN tenant.hr_employees e ON e.id=g.employee_id LEFT JOIN tenant.hr_goals p ON p.id=g.parent_goal_id
    WHERE g.organization_id=$1 AND g.company_id=$2${extra} ORDER BY g.due_date, g.created_at LIMIT 1000`, params);
  return rows;
}
export async function saveGoal(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const { employee, isSelf, isManager, isHr } = await actorFor(client, c, employeeId);
  if (!isSelf && !isManager && !isHr) throw new HrError(403, "You can set goals for yourself or your reports.", "HR_FORBIDDEN");
  if (!["active", "on_leave", "on_notice"].includes(employee.status)) throw new HrError(409, "Goals are for a current employee.", "HR_EMPLOYEE_STATE");
  const title = text(input.title, 200);
  if (!title) throw new HrError(400, "A goal needs a title.", "HR_GOAL_INVALID");
  const metricType = oneOf(String(input.metricType ?? "percent"), ["percent", "number", "boolean"], "Metric type");
  const target = metricType === "boolean" ? 1 : positive(input.targetValue ?? 100, "Target");
  const start = dateRequired(input.startDate, "Start date");
  const due = dateRequired(input.dueDate, "Due date");
  if (due < start) throw new HrError(400, "The due date is before the start date.", "HR_GOAL_INVALID");
  const weight = Math.trunc(nonNegative(input.weight ?? 100, "Weight", 100));
  if (weight < 1 || weight > 100) throw new HrError(400, "Weight is 1 to 100.", "HR_GOAL_INVALID");
  const parentId = uuidOrNull(input.parentGoalId, "Parent goal");
  if (parentId) {
    const parent = await qx(client, `SELECT employee_id FROM tenant.hr_goals WHERE organization_id=$1 AND id=$2`, [c.organizationId, parentId]);
    if (!parent.rows[0]) throw new HrError(400, "Parent goal was not found.", "HR_GOAL_INVALID");
  }
  if (input.id) {
    const cur = (await qx(client, `SELECT * FROM tenant.hr_goals WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.id, "Goal")])).rows[0];
    if (!cur) throw new HrError(404, "Goal was not found.", "HR_GOAL_NOT_FOUND");
    if (cur.status === "completed" || cur.status === "cancelled") throw new HrError(409, "A closed goal cannot be edited.", "HR_GOAL_STATE");
    const { rows } = await qx(client, `UPDATE tenant.hr_goals SET title=$4, description=$5, metric_type=$6, target_value=$7, weight=$8, start_date=$9, due_date=$10, parent_goal_id=$11, updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, cur.id, title, textOrNull(input.description, 2000), metricType, target, weight, start, due, parentId]);
    return rows[0];
  }
  const { rows } = await qx(client, `INSERT INTO tenant.hr_goals(organization_id,company_id,employee_id,parent_goal_id,title,description,metric_type,target_value,weight,start_date,due_date,status,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12) RETURNING *`,
    [c.organizationId, c.companyId, employee.id, parentId, title, textOrNull(input.description, 2000), metricType, target, weight, start, due, c.userId]);
  await recordEvent(client, c, "employee", employee.id, "hr.goal.created", { goalId: rows[0].id, title });
  return rows[0];
}
export async function checkInGoal(client, c, id, input) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_goals WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Goal")]);
  const g = rows[0];
  if (!g) throw new HrError(404, "Goal was not found.", "HR_GOAL_NOT_FOUND");
  const { isSelf, isManager, isHr } = await actorFor(client, c, g.employee_id);
  if (!isSelf && !isManager && !isHr) throw new HrError(403, "You cannot check in on this goal.", "HR_FORBIDDEN");
  if (!["active"].includes(g.status)) throw new HrError(409, "Only an active goal accepts a check-in.", "HR_GOAL_STATE");
  const value = g.metric_type === "boolean" ? (input.value ? 1 : 0) : nonNegative(input.value, "Value");
  await qx(client, `INSERT INTO tenant.hr_goal_checkins(organization_id,goal_id,checkin_date,value,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [c.organizationId, g.id, dateOrNull(input.checkinDate) ?? today(), value, textOrNull(input.note, 1000), c.userId]);
  const complete = value >= Number(g.target_value);
  const { rows: out } = await qx(client, `UPDATE tenant.hr_goals SET current_value=$2, status=CASE WHEN $3 THEN 'completed' ELSE status END, updated_at=now() WHERE id=$1 RETURNING *`, [g.id, value, complete]);
  await recordEvent(client, c, "employee", g.employee_id, "hr.goal.checkin", { goalId: g.id, value, completed: complete });
  return out[0];
}
export async function closeGoal(client, c, id, { status, note }) {
  const target = oneOf(String(status), ["missed", "cancelled"], "Status");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_goals WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Goal")]);
  const g = rows[0];
  if (!g) throw new HrError(404, "Goal was not found.", "HR_GOAL_NOT_FOUND");
  const { isManager, isHr } = await actorFor(client, c, g.employee_id);
  if (!isManager && !isHr) throw new HrError(403, "Only the reporting manager or HR can close a goal this way.", "HR_FORBIDDEN");
  if (g.status !== "active") throw new HrError(409, "Only an active goal can be closed this way.", "HR_GOAL_STATE");
  if (!text(note)) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_goals SET status=$2, updated_at=now() WHERE id=$1 RETURNING *`, [g.id, target]);
  await recordEvent(client, c, "employee", g.employee_id, `hr.goal.${target}`, { goalId: g.id, note: text(note, 300) });
  return out.rows[0];
}

// ---------------------------------------------------------------- review cycles and appraisals (F449, F450)
export async function listReviewCycles(client, c) {
  needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT c.*, (SELECT count(*) FROM tenant.hr_appraisals a WHERE a.cycle_id=c.id)::int AS appraisals, (SELECT count(*) FROM tenant.hr_appraisals a WHERE a.cycle_id=c.id AND a.status='completed')::int AS completed
    FROM tenant.hr_review_cycles c WHERE c.organization_id=$1 AND c.company_id=$2 ORDER BY c.period_start DESC`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveReviewCycle(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new HrError(400, "A cycle needs a code and a name.", "HR_CYCLE_INVALID");
  const start = dateRequired(input.periodStart, "Period start");
  const end = dateRequired(input.periodEnd, "Period end");
  if (end < start) throw new HrError(400, "The period end is before its start.", "HR_CYCLE_INVALID");
  const scale = Math.trunc(nonNegative(input.ratingScale ?? 5, "Rating scale", 5));
  if (scale < 3 || scale > 10) throw new HrError(400, "The rating scale is 3 to 10.", "HR_CYCLE_INVALID");
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.hr_review_cycles(organization_id,company_id,code,name,period_start,period_end,self_review,peer_review,rating_scale,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [c.organizationId, c.companyId, code, name, start, end, input.selfReview !== false, input.peerReview === true, scale, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, `Cycle ${code} already exists.`, "HR_CYCLE_DUPLICATE");
    throw e;
  }
}
export async function openReviewCycle(client, c, id) {
  need(c, MANAGE);
  const cyc = (await qx(client, `SELECT * FROM tenant.hr_review_cycles WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Cycle")])).rows[0];
  if (!cyc) throw new HrError(404, "Cycle was not found.", "HR_CYCLE_NOT_FOUND");
  if (cyc.status !== "draft") throw new HrError(409, "Only a draft cycle can be opened.", "HR_CYCLE_STATE");
  const employees = await qx(client, `SELECT id, manager_employee_id FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND status IN ('active','on_leave') AND manager_employee_id IS NOT NULL`, [c.organizationId, c.companyId]);
  let created = 0;
  for (const e of employees.rows) {
    const ins = await qx(client, `INSERT INTO tenant.hr_appraisals(organization_id,company_id,cycle_id,employee_id,reviewer_employee_id,created_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id`, [c.organizationId, c.companyId, cyc.id, e.id, e.manager_employee_id, c.userId]);
    if (ins.rows[0]) created += 1;
  }
  const out = await qx(client, `UPDATE tenant.hr_review_cycles SET status='open' WHERE id=$1 RETURNING *`, [cyc.id]);
  return { cycle: out.rows[0], appraisalsCreated: created };
}
export async function closeReviewCycle(client, c, id, reason) {
  need(c, MANAGE);
  if (!text(reason)) throw new HrError(400, "Give a reason for closing the cycle.", "HR_REASON_REQUIRED");
  const open = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_appraisals WHERE cycle_id=$1 AND status <> 'completed' AND status <> 'cancelled'`, [uuid(id, "Cycle")]);
  if (open.rows[0].n > 0) throw new HrError(409, `${open.rows[0].n} appraisal(s) in this cycle are not yet completed.`, "HR_CYCLE_OPEN_APPRAISALS");
  const { rows } = await qx(client, `UPDATE tenant.hr_review_cycles SET status='closed' WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Cycle")]);
  if (!rows[0]) throw new HrError(404, "Cycle was not found.", "HR_CYCLE_NOT_FOUND");
  return rows[0];
}

export async function listAppraisals(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND a.status=$${params.length}`; }
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND a.employee_id=$${params.length}`;
  } else if (filters.scope === "toReview") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND a.reviewer_employee_id=$${params.length}`;
  } else needAny(c, VIEW);
  const { rows } = await qx(client, `SELECT a.*, e.employee_number, ${NAME} AS employee_name, r.employee_number AS reviewer_number, ${NAME.replace(/e\./g, "r.")} AS reviewer_name, cy.name AS cycle_name, cy.rating_scale
    FROM tenant.hr_appraisals a JOIN tenant.hr_employees e ON e.id=a.employee_id JOIN tenant.hr_employees r ON r.id=a.reviewer_employee_id JOIN tenant.hr_review_cycles cy ON cy.id=a.cycle_id
    WHERE a.organization_id=$1 AND a.company_id=$2${extra} ORDER BY cy.period_start DESC LIMIT 1000`, params);
  return rows;
}
export async function getAppraisal(client, c, id) {
  const own = await ownEmployee(client, c);
  const { rows } = await qx(client, `SELECT a.*, e.employee_number, ${NAME} AS employee_name, cy.name AS cycle_name, cy.rating_scale, cy.peer_review, cy.self_review FROM tenant.hr_appraisals a JOIN tenant.hr_employees e ON e.id=a.employee_id JOIN tenant.hr_review_cycles cy ON cy.id=a.cycle_id WHERE a.organization_id=$1 AND a.id=$2`, [c.organizationId, uuid(id, "Appraisal")]);
  const a = rows[0];
  if (!a) throw new HrError(404, "Appraisal was not found.", "HR_APPRAISAL_NOT_FOUND");
  const isParty = Boolean(own && (own.id === a.employee_id || own.id === a.reviewer_employee_id));
  if (!isParty) needAny(c, VIEW);
  const goals = await qx(client, `SELECT id, title, target_value, current_value, weight, status FROM tenant.hr_goals WHERE employee_id=$1 AND start_date <= (SELECT period_end FROM tenant.hr_review_cycles WHERE id=$2) AND due_date >= (SELECT period_start FROM tenant.hr_review_cycles WHERE id=$2)`, [a.employee_id, a.cycle_id]);
  const peers = await qx(client, `SELECT p.*, ${NAME.replace(/e\./g, "pe.")} AS peer_name FROM tenant.hr_appraisal_peer_feedback p JOIN tenant.hr_employees pe ON pe.id=p.peer_employee_id WHERE p.appraisal_id=$1`, [a.id]);
  return { ...a, goals: goals.rows, peerFeedback: peers.rows };
}
export async function submitSelfReview(client, c, id, input) {
  const own = await ownEmployee(client, c);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_appraisals WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Appraisal")]);
  const a = rows[0];
  if (!a) throw new HrError(404, "Appraisal was not found.", "HR_APPRAISAL_NOT_FOUND");
  if (!(own && own.id === a.employee_id)) throw new HrError(403, "Only the employee submits their own self review.", "HR_FORBIDDEN");
  if (a.status !== "pending_self") throw new HrError(409, "The self review has already been submitted.", "HR_APPRAISAL_STATE");
  const cyc = (await qx(client, `SELECT rating_scale FROM tenant.hr_review_cycles WHERE id=$1`, [a.cycle_id])).rows[0];
  const rating = Number(input.rating);
  if (!(rating >= 1 && rating <= cyc.rating_scale)) throw new HrError(400, `Rate yourself from 1 to ${cyc.rating_scale}.`, "HR_APPRAISAL_INVALID");
  if (!text(input.comments)) throw new HrError(400, "Add a comment.", "HR_APPRAISAL_INVALID");
  const goalScore = (await qx(client, `SELECT coalesce(sum(least(current_value/target_value,1)*weight)/nullif(sum(weight),0)*100,0) AS s FROM tenant.hr_goals WHERE employee_id=$1 AND due_date BETWEEN (SELECT period_start FROM tenant.hr_review_cycles WHERE id=$2) AND (SELECT period_end FROM tenant.hr_review_cycles WHERE id=$2)`, [a.employee_id, a.cycle_id])).rows[0].s;
  const out = await qx(client, `UPDATE tenant.hr_appraisals SET self_rating=$2, self_comments=$3, self_submitted_at=now(), goal_score=$4, status='pending_manager' WHERE id=$1 RETURNING *`, [a.id, rating, text(input.comments, 3000), round2(Number(goalScore))]);
  await recordEvent(client, c, "employee", a.employee_id, "hr.appraisal.self_submitted", { appraisalId: a.id });
  return out.rows[0];
}
export async function submitPeerFeedback(client, c, id, input) {
  const own = await ownEmployee(client, c);
  if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
  const { rows } = await qx(client, `SELECT a.*, cy.peer_review, cy.rating_scale FROM tenant.hr_appraisals a JOIN tenant.hr_review_cycles cy ON cy.id=a.cycle_id WHERE a.organization_id=$1 AND a.company_id=$2 AND a.id=$3`, [c.organizationId, c.companyId, uuid(id, "Appraisal")]);
  const a = rows[0];
  if (!a) throw new HrError(404, "Appraisal was not found.", "HR_APPRAISAL_NOT_FOUND");
  if (!a.peer_review) throw new HrError(409, "This review cycle does not collect peer feedback.", "HR_APPRAISAL_NO_PEER");
  if (own.id === a.employee_id) throw new HrError(403, "You cannot give peer feedback on your own appraisal.", "SELF_APPROVAL_BLOCKED");
  if (!["pending_self", "pending_manager"].includes(a.status)) throw new HrError(409, "Peer feedback is given before the appraisal is completed.", "HR_APPRAISAL_STATE");
  if (!text(input.comments)) throw new HrError(400, "Add a comment.", "HR_APPRAISAL_INVALID");
  const rating = input.rating === undefined || input.rating === "" ? null : Number(input.rating);
  if (rating !== null && !(rating >= 1 && rating <= a.rating_scale)) throw new HrError(400, `Rate from 1 to ${a.rating_scale}.`, "HR_APPRAISAL_INVALID");
  const { rows: out } = await qx(client, `INSERT INTO tenant.hr_appraisal_peer_feedback(organization_id,appraisal_id,peer_employee_id,rating,comments) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (appraisal_id,peer_employee_id) DO UPDATE SET rating=EXCLUDED.rating, comments=EXCLUDED.comments, submitted_at=now() RETURNING *`, [c.organizationId, a.id, own.id, rating, text(input.comments, 3000)]);
  return out[0];
}
export async function submitManagerReview(client, c, id, input) {
  const own = await ownEmployee(client, c);
  const { rows } = await qx(client, `SELECT a.*, cy.rating_scale, cy.self_review FROM tenant.hr_appraisals a JOIN tenant.hr_review_cycles cy ON cy.id=a.cycle_id WHERE a.organization_id=$1 AND a.company_id=$2 AND a.id=$3 FOR UPDATE OF a`, [c.organizationId, c.companyId, uuid(id, "Appraisal")]);
  const a = rows[0];
  if (!a) throw new HrError(404, "Appraisal was not found.", "HR_APPRAISAL_NOT_FOUND");
  const isReviewer = Boolean(own && own.id === a.reviewer_employee_id);
  if (!isReviewer && !has(c, MANAGE)) throw new HrError(403, "Only the assigned reviewer (or HR) can complete this appraisal.", "HR_FORBIDDEN");
  if (a.employee_id === (own?.id ?? null)) throw new HrError(403, "You cannot review your own appraisal.", "SELF_APPROVAL_BLOCKED");
  const need = a.self_review ? "pending_manager" : "pending_self";
  if (a.status !== need && a.status !== "pending_manager") throw new HrError(409, a.self_review ? "The employee has not yet submitted their self review." : "This appraisal is not awaiting the manager's review.", "HR_APPRAISAL_STATE");
  const rating = Number(input.rating);
  if (!(rating >= 1 && rating <= a.rating_scale)) throw new HrError(400, `Rate from 1 to ${a.rating_scale}.`, "HR_APPRAISAL_INVALID");
  if (!text(input.comments)) throw new HrError(400, "Add a comment.", "HR_APPRAISAL_INVALID");
  const out = await qx(client, `UPDATE tenant.hr_appraisals SET manager_rating=$2, manager_comments=$3, manager_submitted_at=now(), final_rating=$2, final_comments=$3, status='completed', completed_at=now() WHERE id=$1 RETURNING *`,
    [a.id, rating, text(input.comments, 3000)]);
  await recordEvent(client, c, "employee", a.employee_id, "hr.appraisal.completed", { appraisalId: a.id, finalRating: rating });
  return out.rows[0];
}
// A calibration step: HR (someone other than the reviewer) can adjust the final rating with a reason.
export async function calibrateAppraisal(client, c, id, input) {
  need(c, MANAGE);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_appraisals WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Appraisal")]);
  const a = rows[0];
  if (!a) throw new HrError(404, "Appraisal was not found.", "HR_APPRAISAL_NOT_FOUND");
  if (a.status !== "completed") throw new HrError(409, "Only a completed appraisal can be calibrated.", "HR_APPRAISAL_STATE");
  if (a.reviewer_employee_id === (await ownEmployee(client, c))?.id) throw new HrError(403, "Calibration is done by someone other than the original reviewer.", "SELF_APPROVAL_BLOCKED");
  const rating = Number(input.finalRating);
  if (!(rating >= 1 && rating <= 10)) throw new HrError(400, "Give a valid rating.", "HR_APPRAISAL_INVALID");
  if (!text(input.reason)) throw new HrError(400, "Give a reason for the calibration.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_appraisals SET final_rating=$2, final_comments=coalesce(final_comments,'') || $3, calibrated_by=$4 WHERE id=$1 RETURNING *`,
    [a.id, rating, `\nCalibrated: ${text(input.reason, 500)}`, c.userId]);
  await recordEvent(client, c, "employee", a.employee_id, "hr.appraisal.calibrated", { appraisalId: a.id, finalRating: rating });
  return out.rows[0];
}

// ---------------------------------------------------------------- skills (F451)
export async function listSkills(client, c) {
  needAny(c, ["hr_payroll.view", ...VIEW]);
  const { rows } = await qx(client, `SELECT s.*, (SELECT count(*) FROM tenant.hr_employee_skills es WHERE es.skill_id=s.id)::int AS employees FROM tenant.hr_skills s WHERE s.organization_id=$1 AND s.company_id=$2 ORDER BY s.category NULLS LAST, s.name`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveSkill(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new HrError(400, "A skill needs a code and a name.", "HR_SKILL_INVALID");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.hr_skills SET name=$4, category=$5, active=$6 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, [c.organizationId, c.companyId, uuid(input.id, "Skill"), name, textOrNull(input.category, 60), input.active !== false]);
    if (!rows[0]) throw new HrError(404, "Skill was not found.", "HR_SKILL_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.hr_skills(organization_id,company_id,code,name,category,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, c.companyId, code, name, textOrNull(input.category, 60), c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, `Skill ${code} already exists.`, "HR_SKILL_DUPLICATE");
    throw e;
  }
}
export async function listEmployeeSkills(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId];
  let extra = "";
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra = ` AND es.employee_id=$2`;
  } else if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra = ` AND es.employee_id=$2`; }
  else needAny(c, ["hr_payroll.view", ...VIEW]);
  const { rows } = await qx(client, `SELECT es.*, s.code AS skill_code, s.name AS skill_name, s.category, e.employee_number, ${NAME} AS employee_name FROM tenant.hr_employee_skills es JOIN tenant.hr_skills s ON s.id=es.skill_id JOIN tenant.hr_employees e ON e.id=es.employee_id WHERE es.organization_id=$1${extra} ORDER BY s.category NULLS LAST, s.name LIMIT 2000`, params);
  return rows;
}
export async function setEmployeeSkill(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const isSelf = Boolean(own && own.id === employeeId);
  if (!isSelf) need(c, MANAGE);
  await loadEmployee(client, c, employeeId);
  const skill = (await qx(client, `SELECT id FROM tenant.hr_skills WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.skillId, "Skill")])).rows[0];
  if (!skill) throw new HrError(400, "Skill was not found or is inactive.", "HR_SKILL_NOT_FOUND");
  const proficiency = Math.trunc(Number(input.proficiency));
  if (!(proficiency >= 1 && proficiency <= 5)) throw new HrError(400, "Proficiency is 1 to 5.", "HR_SKILL_INVALID");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_employee_skills(organization_id,employee_id,skill_id,proficiency,self_rated,assessed_by,notes) VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (employee_id,skill_id) DO UPDATE SET proficiency=EXCLUDED.proficiency, self_rated=EXCLUDED.self_rated, assessed_by=EXCLUDED.assessed_by, assessed_at=now(), notes=EXCLUDED.notes RETURNING *`,
    [c.organizationId, employeeId, skill.id, proficiency, isSelf, isSelf ? null : c.userId, textOrNull(input.notes, 500)]);
  return rows[0];
}

// ---------------------------------------------------------------- training (F452)
export async function listCourses(client, c) {
  needAny(c, ["hr_payroll.view", ...VIEW]);
  const { rows } = await qx(client, `SELECT co.*, sk.name AS skill_name, (SELECT count(*) FROM tenant.hr_training_sessions se WHERE se.course_id=co.id)::int AS sessions FROM tenant.hr_courses co LEFT JOIN tenant.hr_skills sk ON sk.id=co.skill_id WHERE co.organization_id=$1 AND co.company_id=$2 ORDER BY co.title`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveCourse(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 30).toUpperCase();
  const title = text(input.title, 200);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !title) throw new HrError(400, "A course needs a code and a title.", "HR_COURSE_INVALID");
  const skillId = uuidOrNull(input.skillId, "Skill");
  const duration = input.durationHours === undefined || input.durationHours === "" ? null : positive(input.durationHours, "Duration");
  if (input.id) {
    const { rows } = await qx(client, `UPDATE tenant.hr_courses SET title=$4, description=$5, category=$6, provider=$7, duration_hours=$8, skill_id=$9, mandatory=$10, active=$11 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Course"), title, textOrNull(input.description, 2000), textOrNull(input.category, 60), textOrNull(input.provider, 120), duration, skillId, input.mandatory === true, input.active !== false]);
    if (!rows[0]) throw new HrError(404, "Course was not found.", "HR_COURSE_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.hr_courses(organization_id,company_id,code,title,description,category,provider,duration_hours,skill_id,mandatory,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [c.organizationId, c.companyId, code, title, textOrNull(input.description, 2000), textOrNull(input.category, 60), textOrNull(input.provider, 120), duration, skillId, input.mandatory === true, c.userId]);
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, `Course ${code} already exists.`, "HR_COURSE_DUPLICATE");
    throw e;
  }
}
export async function listTrainingSessions(client, c, filters = {}) {
  needAny(c, ["hr_payroll.view", ...VIEW]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.courseId) { params.push(uuid(filters.courseId, "Course")); extra = ` AND s.course_id=$3`; }
  const { rows } = await qx(client, `SELECT s.*, co.title AS course_title, co.code AS course_code, (SELECT count(*) FROM tenant.hr_training_enrolments en WHERE en.session_id=s.id AND en.status <> 'cancelled')::int AS enrolled
    FROM tenant.hr_training_sessions s JOIN tenant.hr_courses co ON co.id=s.course_id WHERE s.organization_id=$1 AND s.company_id=$2${extra} ORDER BY s.starts_at DESC LIMIT 500`, params);
  return rows;
}
export async function scheduleTrainingSession(client, c, input) {
  need(c, MANAGE);
  const course = (await qx(client, `SELECT * FROM tenant.hr_courses WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.courseId, "Course")])).rows[0];
  if (!course) throw new HrError(400, "Course was not found or is inactive.", "HR_COURSE_NOT_FOUND");
  const starts = new Date(String(input.startsAt ?? ""));
  const ends = new Date(String(input.endsAt ?? ""));
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) throw new HrError(400, "Give a valid start and end time.", "HR_SESSION_INVALID");
  const capacity = input.capacity === undefined || input.capacity === "" ? null : Math.trunc(positive(input.capacity, "Capacity"));
  const number = `${course.code}-${Date.now().toString(36).toUpperCase()}`;
  const { rows } = await qx(client, `INSERT INTO tenant.hr_training_sessions(organization_id,company_id,course_id,session_code,starts_at,ends_at,location,trainer,capacity,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, course.id, number, starts.toISOString(), ends.toISOString(), textOrNull(input.location, 200), textOrNull(input.trainer, 120), capacity, c.userId]);
  return rows[0];
}
export async function cancelTrainingSession(client, c, id, reason) {
  need(c, MANAGE);
  if (!text(reason)) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_training_sessions SET status='cancelled' WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='scheduled' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Session")]);
  if (!rows[0]) throw new HrError(409, "Only a scheduled session can be cancelled.", "HR_SESSION_STATE");
  await qx(client, `UPDATE tenant.hr_training_enrolments SET status='cancelled' WHERE session_id=$1 AND status='enrolled'`, [rows[0].id]);
  await recordEvent(client, c, "training_session", rows[0].id, "hr.training.session_cancelled", { reason: text(reason, 300) });
  return rows[0];
}
export async function listTrainingEnrolments(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId];
  let extra = "";
  if (filters.sessionId) { params.push(uuid(filters.sessionId, "Session")); extra += ` AND en.session_id=$${params.length}`; }
  if (filters.scope === "mine") {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id); extra += ` AND en.employee_id=$${params.length}`;
  } else needAny(c, ["hr_payroll.view", ...VIEW]);
  const { rows } = await qx(client, `SELECT en.*, e.employee_number, ${NAME} AS employee_name, s.session_code, s.starts_at, co.title AS course_title
    FROM tenant.hr_training_enrolments en JOIN tenant.hr_employees e ON e.id=en.employee_id JOIN tenant.hr_training_sessions s ON s.id=en.session_id JOIN tenant.hr_courses co ON co.id=s.course_id
    WHERE en.organization_id=$1${extra} ORDER BY s.starts_at DESC LIMIT 1000`, params);
  return rows;
}
export async function enrollInTraining(client, c, input) {
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const isSelf = Boolean(own && own.id === employeeId);
  if (!isSelf) need(c, MANAGE);
  const session = (await qx(client, `SELECT * FROM tenant.hr_training_sessions WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(input.sessionId, "Session")])).rows[0];
  if (!session) throw new HrError(404, "Session was not found.", "HR_SESSION_NOT_FOUND");
  if (session.status !== "scheduled") throw new HrError(409, "Only a scheduled session accepts enrolment.", "HR_SESSION_STATE");
  // check for an existing (even cancelled) enrolment before capacity, so a re-enrolment attempt by
  // the same employee reports "already enrolled" rather than a misleading "session full"
  const existing = await qx(client, `SELECT status FROM tenant.hr_training_enrolments WHERE session_id=$1 AND employee_id=$2`, [session.id, employeeId]);
  if (existing.rows[0] && existing.rows[0].status !== "cancelled") throw new HrError(409, "Already enrolled in this session.", "HR_ENROLMENT_DUPLICATE");
  if (session.capacity !== null) {
    const filled = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_training_enrolments WHERE session_id=$1 AND status <> 'cancelled'`, [session.id]);
    if (filled.rows[0].n >= session.capacity) throw new HrError(409, "This session is full.", "HR_SESSION_FULL");
  }
  if (existing.rows[0]) {
    const { rows } = await qx(client, `UPDATE tenant.hr_training_enrolments SET status='enrolled', enrolled_by=$3, enrolled_at=now(), score=NULL, feedback=NULL, completed_at=NULL WHERE session_id=$1 AND employee_id=$2 RETURNING *`, [session.id, employeeId, c.userId]);
    return rows[0];
  }
  const { rows } = await qx(client, `INSERT INTO tenant.hr_training_enrolments(organization_id,session_id,employee_id,enrolled_by) VALUES ($1,$2,$3,$4) RETURNING *`, [c.organizationId, session.id, employeeId, c.userId]);
  return rows[0];
}
export async function recordTrainingCompletion(client, c, id, input) {
  need(c, MANAGE);
  const status = oneOf(String(input.status), ["attended", "no_show"], "Status");
  const score = input.score === undefined || input.score === "" ? null : nonNegative(input.score, "Score");
  const { rows } = await qx(client, `UPDATE tenant.hr_training_enrolments SET status=$2, score=$3, feedback=$4, completed_at=now() WHERE organization_id=$1 AND id=$5 AND status='enrolled' RETURNING *`,
    [c.organizationId, status, score, textOrNull(input.feedback, 1000), uuid(id, "Enrolment")]);
  if (!rows[0]) throw new HrError(409, "Only an enrolled (not yet marked) enrolment can be completed.", "HR_ENROLMENT_STATE");
  // completing "attended" with a linked skill raises (or does not lower) the employee's proficiency
  if (status === "attended") {
    const session = (await qx(client, `SELECT s.*, co.skill_id FROM tenant.hr_training_sessions s JOIN tenant.hr_courses co ON co.id=s.course_id WHERE s.id=$1`, [rows[0].session_id])).rows[0];
    if (session.skill_id) {
      await qx(client, `INSERT INTO tenant.hr_employee_skills(organization_id,employee_id,skill_id,proficiency,self_rated,assessed_by,notes) VALUES ($1,$2,$3,3,false,$4,'From training completion')
        ON CONFLICT (employee_id,skill_id) DO UPDATE SET proficiency=greatest(tenant.hr_employee_skills.proficiency,3), assessed_by=$4, assessed_at=now()`, [c.organizationId, rows[0].employee_id, session.skill_id, c.userId]);
    }
  }
  await recordEvent(client, c, "employee", rows[0].employee_id, "hr.training.completed", { enrolmentId: rows[0].id, status });
  return rows[0];
}

export async function getPerformanceDashboard(client, c) {
  needAny(c, VIEW);
  const [goals, appraisals, training] = await seq([
    () => qx(client, `SELECT status, count(*)::int AS n FROM tenant.hr_goals WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT status, count(*)::int AS n FROM tenant.hr_appraisals WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS n FROM tenant.hr_training_enrolments en JOIN tenant.hr_training_sessions s ON s.id=en.session_id WHERE en.organization_id=$1 AND s.company_id=$2 AND s.status='scheduled' AND en.status='enrolled'`, [c.organizationId, c.companyId]),
  ]);
  return { goalsByStatus: Object.fromEntries(goals.rows.map((r) => [r.status, r.n])), appraisalsByStatus: Object.fromEntries(appraisals.rows.map((r) => [r.status, r.n])), upcomingTrainingEnrolments: training.rows[0].n };
}
