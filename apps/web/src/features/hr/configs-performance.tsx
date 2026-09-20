"use client";

import { act, type Row } from "@/features/hr/shared/client";
import type { RegisterConfig, RowAction } from "@/features/hr/shared/Register";
import { badge, calendarDate, col, opts, quantity, strong, text } from "@/features/hr/configs";

// ---------------------------------------------------------------- F449/F450: review cycles and appraisals
const reviewCycles: RegisterConfig = {
  key: "review-cycles",
  title: "Review cycles",
  description: "A period-bound appraisal round. Opening it creates one appraisal for every employee who has a reporting manager, ready for self review. It only closes once every appraisal in it is completed or cancelled.",
  searchLabel: "Search review cycles",
  emptyTitle: "No review cycles yet",
  emptyDescription: "Create a review cycle for the half-year or quarter.",
  source: { kind: "view", view: "review-cycles" },
  createLabel: "New review cycle",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "review-cycle-save", success: "Saved." },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "periodStart", label: "Period start", kind: "date", required: true, rowKey: "period_start" },
    { name: "periodEnd", label: "Period end", kind: "date", required: true, rowKey: "period_end" },
    { name: "ratingScale", label: "Rating scale (top rating)", kind: "number", step: 1, min: 3, defaultValue: 5, rowKey: "rating_scale" },
    { name: "selfReview", label: "Self review", kind: "bool", defaultValue: "true", rowKey: "self_review" },
    { name: "peerReview", label: "Peer review", kind: "bool", defaultValue: "false", rowKey: "peer_review" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("period", "Period", (r) => `${calendarDate(r.period_start)} – ${calendarDate(r.period_end)}`),
    col("appraisals", "Appraisals", (r) => `${String(r.completed)} of ${String(r.appraisals)} completed`),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["code", "name", "status"]),
  rowActions: [
    { label: "Open", permission: "hr_payroll.employee.manage", show: (r) => r.status === "draft", run: (r) => act("review-cycle-open", { id: r.id }), success: "Opened. Appraisals were created for every employee with a reporting manager." },
    { label: "Close", permission: "hr_payroll.employee.manage", show: (r) => r.status === "open", run: (r, note) => act("review-cycle-close", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Closed." },
  ],
};

const RATING: RowAction["fields"] = [
  { name: "rating", label: "Rating", kind: "number", step: 1, min: 1, required: true },
  { name: "comments", label: "Comments", kind: "textarea", required: true },
];

function appraisalRegister(scope: "mine" | "toReview" | "all"): RegisterConfig {
  const title = scope === "mine" ? "My appraisals" : scope === "toReview" ? "Appraisals to review" : "Appraisals";
  const actions: RowAction[] =
    scope === "mine"
      ? [{ label: "Submit self review", show: (r) => r.status === "pending_self", fields: RATING, run: (r, _n, v) => act("appraisal-self-review", { id: r.id, rating: v.rating, comments: v.comments }), success: "Submitted." }]
      : scope === "toReview"
        ? [
            { label: "Complete review", show: (r) => ["pending_self", "pending_manager"].includes(String(r.status)), fields: RATING, run: (r, _n, v) => act("appraisal-manager-review", { id: r.id, rating: v.rating, comments: v.comments }), success: "Completed." },
            { label: "Give peer feedback", show: (r) => r.peer_review && r.status !== "completed" && r.status !== "cancelled", fields: [{ name: "rating", label: "Rating (optional)", kind: "number", step: 1, min: 1 }, { name: "comments", label: "Comments", kind: "textarea", required: true }], run: (r, _n, v) => act("appraisal-peer-feedback", { id: r.id, rating: v.rating || undefined, comments: v.comments }), success: "Feedback recorded." },
          ]
        : [
            { label: "Calibrate", permission: "hr_payroll.employee.manage", show: (r) => r.status === "completed", fields: [{ name: "finalRating", label: "Final rating", kind: "number", step: 1, min: 1, required: true }], note: { label: "Reason", required: true }, run: (r, note, v) => act("appraisal-calibrate", { id: r.id, finalRating: v.finalRating, reason: note }), success: "Calibrated." },
          ];
  return {
    key: `appraisals-${scope}`,
    title,
    description: scope === "mine" ? "Your appraisal in each review cycle: rate yourself and comment, then your manager completes it." : scope === "toReview" ? "Appraisals where you are the assigned reviewer." : "Every appraisal, across every review cycle.",
    searchLabel: `Search ${title.toLowerCase()}`,
    emptyTitle: "No appraisals",
    emptyDescription: "Appraisals appear once a review cycle is opened.",
    source: { kind: "view", view: "appraisals", params: { scope } },
    filters: scope === "all" ? [{ name: "status", label: "Status", options: opts("pending_self", "pending_manager", "completed", "cancelled") }] : undefined,
    columns: () => [
      ...(scope === "mine" ? [] : [col("employee", "Employee", (r: Row) => `${r.employee_name} (${r.employee_number})`)]),
      col("cycle", "Cycle", (r) => String(r.cycle_name)),
      col("self", "Self rating", (r) => (r.self_rating === null ? "—" : quantity(r.self_rating))),
      col("manager", "Manager rating", (r) => (r.manager_rating === null ? "—" : quantity(r.manager_rating))),
      col("final", "Final rating", (r) => (r.final_rating === null ? "—" : quantity(r.final_rating))),
      badge("status", "Status", (r) => r.status),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "cycle_name", "status"]),
    rowActions: actions,
  };
}

// ---------------------------------------------------------------- F448: goals
function goalsRegister(scope: "mine" | "team" | "all"): RegisterConfig {
  const title = scope === "mine" ? "My goals" : scope === "team" ? "Team goals" : "Goals";
  return {
    key: `goals-${scope}`,
    title,
    description: "A measurable goal, optionally aligned to a manager's goal, tracked with check-ins to its target.",
    searchLabel: `Search ${title.toLowerCase()}`,
    emptyTitle: "No goals yet",
    emptyDescription: scope === "mine" ? "Set a goal for this period." : "A goal appears here once it is set.",
    source: { kind: "view", view: "goals", params: { scope } },
    filters: [{ name: "status", label: "Status", options: opts("active", "completed", "missed", "cancelled") }],
    createLabel: "New goal",
    createPermission: scope === "all" ? "hr_payroll.employee.manage" : undefined,
    save: { action: "goal-save", success: "Saved." },
    fields: [
      ...(scope !== "mine" ? [{ name: "employeeId", label: "Employee", kind: "select" as const, options: "employees" as const, required: true }] : []),
      { name: "title", label: "Title", kind: "text", required: true, wide: true },
      { name: "description", label: "Description", kind: "textarea", wide: true },
      { name: "parentGoalId", label: "Aligns to (parent goal)", kind: "select", options: "goals", rowKey: "parent_goal_id" },
      { name: "metricType", label: "Metric", kind: "select", defaultValue: "percent", options: opts("percent", "number", "boolean"), rowKey: "metric_type" },
      { name: "targetValue", label: "Target value", kind: "number", step: 1, defaultValue: 100, rowKey: "target_value" },
      { name: "weight", label: "Weight (of the appraisal)", kind: "number", step: 5, min: 1, defaultValue: 100 },
      { name: "startDate", label: "Start date", kind: "date", required: true, rowKey: "start_date" },
      { name: "dueDate", label: "Due date", kind: "date", required: true, rowKey: "due_date" },
    ],
    columns: () => [
      ...(scope === "mine" ? [] : [col("employee", "Employee", (r: Row) => `${r.employee_name} (${r.employee_number})`)]),
      strong("title", "Title", (r) => String(r.title)),
      col("parent", "Aligned to", (r) => String(r.parent_title ?? "—")),
      col("progress", "Progress", (r) => `${quantity(r.current_value)} / ${quantity(r.target_value)}`),
      col("checkins", "Check-ins", (r) => quantity(r.checkins)),
      col("due", "Due", (r) => calendarDate(r.due_date)),
      badge("status", "Status", (r) => r.status),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "title", "status"]),
    rowActions: [
      { label: "Check in", show: (r) => r.status === "active", fields: [{ name: "value", label: "Current value", kind: "number", step: 1, required: true }, { name: "note", label: "Note", kind: "text", wide: true }], run: (r, _n, v) => act("goal-checkin", { id: r.id, value: v.value, note: v.note }), success: "Recorded." },
      { label: "Mark missed", show: (r) => r.status === "active", note: { label: "Reason", required: true }, run: (r, note) => act("goal-close", { id: r.id, status: "missed", note }), success: "Marked missed." },
      { label: "Cancel", show: (r) => r.status === "active", note: { label: "Reason", required: true }, run: (r, note) => act("goal-close", { id: r.id, status: "cancelled", note }), success: "Cancelled." },
    ],
  };
}

// ---------------------------------------------------------------- F451: skills
const skills: RegisterConfig = {
  key: "skills",
  title: "Skills",
  description: "The skills registry used for employee proficiency and, optionally, linked to a training course.",
  searchLabel: "Search skills",
  emptyTitle: "No skills yet",
  emptyDescription: "Add the skills you want to track proficiency and training against.",
  source: { kind: "view", view: "skills" },
  createLabel: "New skill",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "skill-save", success: "Saved." },
  edit: { action: "skill-save", permission: "hr_payroll.employee.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "category", label: "Category", kind: "text" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("category", "Category", (r) => String(r.category ?? "—")), col("employees", "Employees rated", (r) => quantity(r.employees)), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name", "category"]),
};

function employeeSkillsRegister(scope: "mine" | "all"): RegisterConfig {
  return {
    key: `employee-skills-${scope}`,
    title: scope === "mine" ? "My skills" : "Skills matrix",
    description: scope === "mine" ? "Rate your own proficiency, 1 (beginner) to 5 (expert)." : "Every employee's rated proficiency, self-rated or assessed.",
    searchLabel: "Search",
    emptyTitle: "Nothing rated yet",
    emptyDescription: scope === "mine" ? "Rate a skill to see it here." : "A rating appears here once an employee or their manager rates a skill.",
    source: { kind: "view", view: "employee-skills", params: { scope } },
    createLabel: scope === "mine" ? "Rate a skill" : "Assess a skill",
    createPermission: scope === "all" ? "hr_payroll.employee.manage" : undefined,
    save: { action: "employee-skill-set", success: "Saved." },
    fields: [
      ...(scope === "all" ? [{ name: "employeeId", label: "Employee", kind: "select" as const, options: "employees" as const, required: true }] : []),
      { name: "skillId", label: "Skill", kind: "select", options: "skills", required: true },
      { name: "proficiency", label: "Proficiency (1-5)", kind: "number", step: 1, min: 1, required: true },
      { name: "notes", label: "Notes", kind: "text", wide: true },
    ],
    columns: () => [
      ...(scope === "mine" ? [] : [col("employee", "Employee", (r: Row) => `${r.employee_name} (${r.employee_number})`)]),
      col("skill", "Skill", (r) => `${r.skill_name} (${r.category ?? "—"})`),
      col("proficiency", "Proficiency", (r) => quantity(r.proficiency)),
      col("source", "Rated by", (r) => (r.self_rated ? "Self" : "Assessed")),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "skill_name", "category"]),
  };
}

// ---------------------------------------------------------------- F452: training
const courses: RegisterConfig = {
  key: "courses",
  title: "Courses",
  description: "The training catalogue. Link a course to a skill so completing it raises that skill's proficiency.",
  searchLabel: "Search courses",
  emptyTitle: "No courses yet",
  emptyDescription: "Add a course to schedule sessions against it.",
  source: { kind: "view", view: "courses" },
  createLabel: "New course",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "course-save", success: "Saved." },
  edit: { action: "course-save", permission: "hr_payroll.employee.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "title", label: "Title", kind: "text", required: true },
    { name: "description", label: "Description", kind: "textarea", wide: true },
    { name: "category", label: "Category", kind: "text" },
    { name: "provider", label: "Provider", kind: "text" },
    { name: "durationHours", label: "Duration (hours)", kind: "number", step: 1, rowKey: "duration_hours" },
    { name: "skillId", label: "Skill it builds", kind: "select", options: "skills", rowKey: "skill_id" },
    { name: "mandatory", label: "Mandatory", kind: "bool", defaultValue: "false" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("title", "Title", (r) => String(r.title)), col("category", "Category", (r) => String(r.category ?? "—")), col("skill", "Builds skill", (r) => String(r.skill_name ?? "—")), col("sessions", "Sessions", (r) => quantity(r.sessions)), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "title", "category", "provider"]),
};

const trainingSessions: RegisterConfig = {
  key: "training-sessions",
  title: "Training sessions",
  description: "A scheduled run of a course, with an optional seat capacity.",
  searchLabel: "Search sessions",
  emptyTitle: "No sessions scheduled",
  emptyDescription: "Schedule a session for a course.",
  source: { kind: "view", view: "training-sessions" },
  createLabel: "Schedule session",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "training-session-schedule", success: "Scheduled." },
  fields: [
    { name: "courseId", label: "Course", kind: "select", options: "courses", required: true },
    { name: "startsAt", label: "Starts", kind: "datetime", required: true },
    { name: "endsAt", label: "Ends", kind: "datetime", required: true },
    { name: "location", label: "Location", kind: "text" },
    { name: "trainer", label: "Trainer", kind: "text" },
    { name: "capacity", label: "Capacity (blank = unlimited)", kind: "number", step: 1 },
  ],
  columns: () => [
    strong("session", "Session", (r) => String(r.session_code)),
    col("course", "Course", (r) => String(r.course_title)),
    col("starts", "Starts", (r) => calendarDate(r.starts_at)),
    col("trainer", "Trainer", (r) => String(r.trainer ?? "—")),
    col("enrolled", "Enrolled", (r) => `${String(r.enrolled)}${r.capacity === null ? "" : ` of ${String(r.capacity)}`}`),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["session_code", "course_title", "trainer", "status"]),
  rowActions: [{ label: "Cancel", permission: "hr_payroll.employee.manage", show: (r) => r.status === "scheduled", note: { label: "Reason", required: true }, run: (r, note) => act("training-session-cancel", { id: r.id, reason: note }), success: "Cancelled." }],
};

function trainingEnrolmentsRegister(scope: "mine" | "all"): RegisterConfig {
  return {
    key: `training-enrolments-${scope}`,
    title: scope === "mine" ? "My training" : "Training enrolments",
    description: scope === "mine" ? "Sessions you are enrolled in." : "Every enrolment, across every session.",
    searchLabel: "Search",
    emptyTitle: "No enrolments",
    emptyDescription: scope === "mine" ? "Enrol in a scheduled session." : "An enrolment appears here once an employee enrols.",
    source: { kind: "view", view: "training-enrolments", params: { scope } },
    createLabel: "Enrol",
    createPermission: scope === "all" ? "hr_payroll.employee.manage" : undefined,
    save: { action: "training-enroll", success: "Enrolled." },
    fields: [
      ...(scope === "all" ? [{ name: "employeeId", label: "Employee", kind: "select" as const, options: "employees" as const, required: true }] : []),
      { name: "sessionId", label: "Session", kind: "select", options: "trainingSessions", required: true },
    ],
    columns: () => [
      ...(scope === "mine" ? [] : [col("employee", "Employee", (r: Row) => `${r.employee_name} (${r.employee_number})`)]),
      col("course", "Course", (r) => String(r.course_title)),
      col("session", "Session", (r) => String(r.session_code)),
      col("starts", "Starts", (r) => calendarDate(r.starts_at)),
      col("score", "Score", (r) => (r.score === null ? "—" : quantity(r.score))),
      badge("status", "Status", (r) => r.status),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "course_title", "session_code", "status"]),
    rowActions: scope === "all" ? [{ label: "Mark attended", permission: "hr_payroll.employee.manage", show: (r) => r.status === "enrolled", fields: [{ name: "score", label: "Score (optional)", kind: "number", step: 1 }, { name: "feedback", label: "Feedback", kind: "text", wide: true }], run: (r, _n, v) => act("training-complete", { id: r.id, status: "attended", score: v.score || undefined, feedback: v.feedback }), success: "Marked attended." }, { label: "Mark no-show", permission: "hr_payroll.employee.manage", show: (r) => r.status === "enrolled", run: (r) => act("training-complete", { id: r.id, status: "no_show" }), success: "Marked." }] : [],
  };
}

export const PERFORMANCE_REGISTERS: Record<string, RegisterConfig> = {
  "review-cycles": reviewCycles,
  appraisals: appraisalRegister("all"),
  "my-appraisals": appraisalRegister("mine"),
  "appraisals-to-review": appraisalRegister("toReview"),
  goals: goalsRegister("all"),
  "my-goals": goalsRegister("mine"),
  "team-goals": goalsRegister("team"),
  skills,
  "employee-skills": employeeSkillsRegister("all"),
  "my-skills": employeeSkillsRegister("mine"),
  courses,
  "training-sessions": trainingSessions,
  "training-enrolments": trainingEnrolmentsRegister("all"),
  "my-training": trainingEnrolmentsRegister("mine"),
};
