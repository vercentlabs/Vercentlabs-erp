"use client";

import { act } from "@/features/hr/shared/client";
import type { RegisterConfig } from "@/features/hr/shared/Register";
import { badge, calendarDate, col, dateTime, label, link, opts, quantity, strong, text } from "@/features/hr/configs";

const EMPLOYMENT_TYPES = opts("permanent", "contract", "intern", "consultant", "part_time", "temporary");
const SOURCES = opts("referral", "portal", "agency", "campus", "social", "walk_in", "other");
const inr = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 }));
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : undefined);

const openings: RegisterConfig = {
  key: "openings",
  title: "Job openings",
  description: "Positions to fill. An opening is requested, approved by a second person, then takes applications until its positions are filled.",
  searchLabel: "Search job openings",
  emptyTitle: "No job openings",
  emptyDescription: "Request an opening to start hiring.",
  source: { kind: "view", view: "openings" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "pending_approval", "open", "on_hold", "closed", "cancelled") }],
  createLabel: "New opening",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "opening-save", success: "Opening saved as a draft. Submit it for approval." },
  edit: { action: "opening-save", show: (r) => ["draft", "pending_approval", "open", "on_hold"].includes(String(r.status)) },
  fields: [
    { name: "title", label: "Title", kind: "text", required: true, wide: true },
    { name: "departmentId", label: "Department", kind: "select", options: "departments", rowKey: "department_id" },
    { name: "designationId", label: "Designation", kind: "select", options: "designations", rowKey: "designation_id" },
    { name: "hiringManagerEmployeeId", label: "Hiring manager", kind: "select", options: "employees", rowKey: "hiring_manager_employee_id" },
    { name: "employmentType", label: "Employment type", kind: "select", defaultValue: "permanent", options: EMPLOYMENT_TYPES, rowKey: "employment_type" },
    { name: "location", label: "Location", kind: "text" },
    { name: "positions", label: "Positions", kind: "number", defaultValue: 1, step: 1, min: 1 },
    { name: "salaryMin", label: "Salary range from (annual)", kind: "number", step: 10000, rowKey: "salary_min" },
    { name: "salaryMax", label: "Salary range to (annual)", kind: "number", step: 10000, rowKey: "salary_max" },
    { name: "targetCloseDate", label: "Target close date", kind: "date", rowKey: "target_close_date" },
    { name: "description", label: "Description", kind: "textarea" },
    { name: "requirements", label: "Requirements", kind: "textarea" },
  ],
  columns: () => [
    strong("number", "Opening", (r) => String(r.opening_number)),
    col("title", "Title", (r) => String(r.title)),
    badge("status", "Status", (r) => r.status),
    col("dept", "Department", (r) => String(r.department_name ?? "—")),
    col("mgr", "Hiring manager", (r) => String(r.hiring_manager_name ?? "—")),
    col("pos", "Filled", (r) => `${r.filled} of ${r.positions}`),
    col("apps", "Live applications", (r) => String(r.active_applications)),
    col("range", "Range", (r) => (r.salary_min === undefined ? "Hidden" : `${inr(r.salary_min)} – ${inr(r.salary_max)}`)),
    col("close", "Target close", (r) => calendarDate(r.target_close_date)),
  ],
  searchText: (r) => text(r, ["opening_number", "title", "department_name", "status"]),
  summary: (rows) => [
    { label: "Open", value: String(rows.filter((r) => r.status === "open").length) },
    { label: "Positions to fill", value: String(rows.filter((r) => r.status === "open").reduce((n, r) => n + Number(r.positions) - Number(r.filled), 0)) },
    { label: "Awaiting approval", value: String(rows.filter((r) => r.status === "pending_approval").length) },
  ],
  rowActions: [
    { label: "Submit for approval", permission: "hr_payroll.employee.manage", show: (r) => r.status === "draft", run: (r) => act("opening-submit", { id: r.id }), success: "Submitted. A second person must approve it." },
    { label: "Approve", permission: "hr_payroll.employee.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("opening-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved. The opening is now open for applications." },
    { label: "Send back", permission: "hr_payroll.employee.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("opening-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Sent back to draft." },
    { label: "Hold", permission: "hr_payroll.employee.manage", show: (r) => r.status === "open", run: (r, note) => act("opening-status", { id: r.id, action: "hold", reason: note }), note: { label: "Reason", required: true }, success: "On hold." },
    { label: "Resume", permission: "hr_payroll.employee.manage", show: (r) => r.status === "on_hold", run: (r) => act("opening-status", { id: r.id, action: "resume" }), success: "Resumed." },
    { label: "Close", permission: "hr_payroll.employee.manage", show: (r) => ["open", "on_hold"].includes(String(r.status)), run: (r, note) => act("opening-status", { id: r.id, action: "close", reason: note }), note: { label: "Reason", required: true }, success: "Closed." },
    { label: "Cancel", permission: "hr_payroll.employee.manage", show: (r) => ["draft", "pending_approval", "open", "on_hold"].includes(String(r.status)), run: (r, note) => act("opening-status", { id: r.id, action: "cancel", reason: note }), note: { label: "Reason", required: true }, success: "Cancelled." },
  ],
};

const candidates: RegisterConfig = {
  key: "candidates",
  title: "Candidates",
  description: "People who applied or were sourced. Email is the identity, so the same person is never entered twice. Expected and current pay are visible only with the sensitive-data permission.",
  searchLabel: "Search candidates",
  emptyTitle: "No candidates yet",
  emptyDescription: "Add a candidate, then apply them to an opening.",
  source: { kind: "view", view: "candidates" },
  filters: [{ name: "status", label: "Status", options: opts("active", "hired", "rejected", "withdrawn") }, { name: "source", label: "Source", options: SOURCES }],
  createLabel: "New candidate",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "candidate-save", success: "Candidate added." },
  edit: { action: "candidate-save" },
  fields: [
    { name: "firstName", label: "First name", kind: "text", required: true, rowKey: "first_name" },
    { name: "lastName", label: "Last name", kind: "text", required: true, rowKey: "last_name" },
    { name: "email", label: "Email", kind: "text", required: true },
    { name: "phone", label: "Phone", kind: "text" },
    { name: "source", label: "Source", kind: "select", defaultValue: "portal", options: SOURCES },
    { name: "referredByEmployeeId", label: "Referred by", kind: "select", options: "employees", rowKey: "referred_by_employee_id", showIf: (v) => v.source === "referral" },
    { name: "currentEmployer", label: "Current employer", kind: "text", rowKey: "current_employer" },
    { name: "currentTitle", label: "Current title", kind: "text", rowKey: "current_title" },
    { name: "experienceYears", label: "Experience (years)", kind: "number", step: 0.5, rowKey: "experience_years" },
    { name: "noticePeriodDays", label: "Notice period (days)", kind: "number", step: 1, rowKey: "notice_period_days" },
    { name: "currentCtc", label: "Current CTC", kind: "number", step: 10000, rowKey: "current_ctc" },
    { name: "expectedCtc", label: "Expected CTC", kind: "number", step: 10000, rowKey: "expected_ctc" },
    { name: "resumeReference", label: "Resume (file reference)", kind: "text", rowKey: "resume_reference", wide: true },
    { name: "skills", label: "Skills (comma separated)", kind: "text", wide: true },
  ],
  columns: () => [
    strong("number", "Candidate", (r) => String(r.candidate_number)),
    col("name", "Name", (r) => String(r.full_name)),
    col("email", "Email", (r) => String(r.email)),
    badge("status", "Status", (r) => r.status),
    col("source", "Source", (r) => label(r.source)),
    col("exp", "Experience", (r) => (r.experience_years === null ? "—" : `${quantity(r.experience_years)} yrs`)),
    col("exp-ctc", "Expected CTC", (r) => (r.expected_ctc === undefined ? "Hidden" : inr(r.expected_ctc))),
    col("apps", "Applications", (r) => String(r.applications)),
  ],
  searchText: (r) => text(r, ["candidate_number", "full_name", "email", "current_employer", "status"]),
};

const applications: RegisterConfig = {
  key: "applications",
  title: "Recruitment pipeline",
  description: "Every application, by stage. An application moves one stage at a time (applied, screening, interview, offer); an offer needs interview feedback. Reject or withdraw with a reason at any point.",
  searchLabel: "Search applications",
  emptyTitle: "No applications yet",
  emptyDescription: "Apply a candidate to an open opening.",
  source: { kind: "view", view: "applications" },
  filters: [{ name: "stage", label: "Stage", options: opts("applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn") }],
  createLabel: "New application",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "application-create", success: "Application created." },
  fields: [
    { name: "openingId", label: "Opening", kind: "select", options: "openOpenings", required: true },
    { name: "candidateId", label: "Candidate", kind: "select", options: "candidatesList", required: true },
  ],
  columns: () => [
    col("candidate", "Candidate", (r) => `${r.candidate_name} (${r.candidate_number})`),
    col("opening", "Opening", (r) => `${r.opening_number} — ${r.opening_title}`),
    badge("stage", "Stage", (r) => r.stage),
    col("interviews", "Interviews done", (r) => String(r.interviews_done)),
    col("rating", "Average rating", (r) => (r.average_rating === null ? "—" : String(r.average_rating))),
    col("moved", "Last moved", (r) => dateTime(r.stage_changed_at)),
    col("reason", "Reason", (r) => String(r.reason ?? "")),
  ],
  searchText: (r) => text(r, ["candidate_name", "candidate_number", "opening_number", "opening_title", "stage"]),
  summary: (rows) => ["applied", "screening", "interview", "offer", "hired"].map((s) => ({ label: label(s), value: String(rows.filter((r) => r.stage === s).length) })),
  rowActions: [
    { label: "To screening", permission: "hr_payroll.employee.manage", show: (r) => r.stage === "applied", run: (r) => act("application-move", { id: r.id, stage: "screening" }), success: "Moved to screening." },
    { label: "To interview", permission: "hr_payroll.employee.manage", show: (r) => r.stage === "screening", run: (r) => act("application-move", { id: r.id, stage: "interview" }), success: "Moved to interview." },
    { label: "To offer", permission: "hr_payroll.employee.manage", show: (r) => r.stage === "interview", run: (r) => act("application-move", { id: r.id, stage: "offer" }), success: "Moved to the offer stage." },
    { label: "Reject", permission: "hr_payroll.employee.manage", show: (r) => ["applied", "screening", "interview", "offer"].includes(String(r.stage)), run: (r, note) => act("application-move", { id: r.id, stage: "rejected", reason: note }), note: { label: "Reason", required: true }, success: "Rejected." },
    { label: "Withdraw", permission: "hr_payroll.employee.manage", show: (r) => ["applied", "screening", "interview", "offer"].includes(String(r.stage)), run: (r, note) => act("application-move", { id: r.id, stage: "withdrawn", reason: note }), note: { label: "Reason", required: true }, success: "Withdrawn." },
  ],
};

const interviewFields = (rows: RegisterConfig["fields"]) => rows;
const interviews: RegisterConfig = {
  key: "interviews",
  title: "Interviews",
  description: "Scheduled rounds. The interviewer cannot be double-booked; feedback (a rating, a recommendation and written notes) is given by the interviewer once the interview has happened.",
  searchLabel: "Search interviews",
  emptyTitle: "No interviews scheduled",
  emptyDescription: "Schedule an interview for a candidate in screening or interview.",
  source: { kind: "view", view: "interviews" },
  filters: [{ name: "status", label: "Status", options: opts("scheduled", "completed", "cancelled", "no_show") }],
  createLabel: "Schedule interview",
  createPermission: "hr_payroll.employee.manage",
  save: { action: "interview-schedule", success: "Interview scheduled.", transform: (v) => ({ scheduledAt: iso(v.scheduledAt) }) },
  fields: interviewFields([
    { name: "applicationId", label: "Application", kind: "select", options: "interviewApplications", required: true },
    { name: "interviewerEmployeeId", label: "Interviewer", kind: "select", options: "employees", required: true },
    { name: "scheduledAt", label: "Date and time", kind: "datetime", required: true },
    { name: "durationMinutes", label: "Duration (minutes)", kind: "number", defaultValue: 45, step: 15, min: 10 },
    { name: "interviewType", label: "Type", kind: "select", defaultValue: "technical", options: opts("phone", "technical", "managerial", "hr", "panel") },
    { name: "mode", label: "Mode", kind: "select", defaultValue: "video", options: opts("video", "onsite", "phone") },
    { name: "location", label: "Location or link", kind: "text", wide: true },
  ]),
  columns: () => [
    col("candidate", "Candidate", (r) => `${r.candidate_name} (${r.candidate_number})`),
    col("role", "For", (r) => String(r.opening_title)),
    col("round", "Round", (r) => `${r.round_number} · ${label(r.interview_type)}`),
    col("who", "Interviewer", (r) => String(r.interviewer_name)),
    col("when", "When", (r) => dateTime(r.scheduled_at)),
    badge("status", "Status", (r) => r.status),
    col("rating", "Rating", (r) => (r.rating ? `${r.rating}/5 · ${label(r.recommendation)}` : "—")),
  ],
  searchText: (r) => text(r, ["candidate_name", "candidate_number", "opening_title", "interviewer_name", "status"]),
  rowActions: [
    { label: "Cancel", permission: "hr_payroll.employee.manage", show: (r) => r.status === "scheduled", run: (r, note) => act("interview-cancel", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Cancelled." },
    { label: "No-show", permission: "hr_payroll.employee.manage", show: (r) => r.status === "scheduled" && new Date(String(r.scheduled_at)).getTime() < Date.now(), run: (r) => act("interview-no-show", { id: r.id }), success: "Marked as a no-show." },
  ],
};

const feedbackAction = {
  label: "Give feedback",
  show: (r: { status?: unknown; scheduled_at?: unknown }) => r.status === "scheduled" && new Date(String(r.scheduled_at)).getTime() <= Date.now(),
  fields: [
    { name: "rating", label: "Rating (1 to 5)", kind: "number" as const, defaultValue: 3, step: 1, min: 1, required: true },
    { name: "recommendation", label: "Recommendation", kind: "select" as const, options: opts("strong_yes", "yes", "no", "strong_no"), required: true },
  ],
  note: { label: "Feedback", required: true },
  run: (r: { id: string }, note: string, v: Record<string, string | number>) => act("interview-feedback", { id: r.id, rating: Number(v.rating), recommendation: v.recommendation, feedback: note }),
  success: "Feedback recorded.",
};
const myInterviews: RegisterConfig = {
  ...interviews,
  key: "my-interviews",
  title: "My interviews",
  description: "Interviews you are conducting. Give feedback once the interview has happened.",
  emptyTitle: "No interviews assigned to you",
  emptyDescription: "Interviews appear here when HR schedules you as the interviewer.",
  source: { kind: "view", view: "me-interviews" },
  createLabel: undefined,
  createPermission: undefined,
  fields: undefined,
  save: undefined,
  rowActions: [feedbackAction as never],
};
// HR can also give feedback on the interviewer's behalf from the full register
interviews.rowActions = [feedbackAction as never, ...(interviews.rowActions ?? [])];

const offers: RegisterConfig = {
  key: "offers",
  title: "Offers",
  description: "Offers of employment. Prepared by one person, approved by another, sent, then accepted or declined. Pay is visible only to those who manage compensation. An accepted offer becomes an employee exactly once.",
  searchLabel: "Search offers",
  emptyTitle: "No offers yet",
  emptyDescription: "Move an application to the offer stage, then prepare the offer.",
  source: { kind: "view", view: "offers" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "pending_approval", "approved", "sent", "accepted", "declined", "expired", "withdrawn") }],
  createLabel: "New offer",
  createPermission: "hr_payroll.compensation.manage",
  save: { action: "offer-create", success: "Offer prepared as a draft." },
  fields: [
    { name: "applicationId", label: "Application", kind: "select", options: "offerApplications", required: true },
    { name: "annualCtc", label: "Annual CTC", kind: "number", step: 10000, required: true },
    { name: "joiningDate", label: "Joining date", kind: "date", required: true },
    { name: "validUntil", label: "Offer valid until", kind: "date", required: true },
    { name: "designationId", label: "Designation", kind: "select", options: "designations" },
    { name: "departmentId", label: "Department", kind: "select", options: "departments" },
    { name: "employmentType", label: "Employment type", kind: "select", defaultValue: "permanent", options: EMPLOYMENT_TYPES },
    { name: "justification", label: "Justification (if outside the approved range)", kind: "text", wide: true },
    { name: "terms", label: "Terms", kind: "textarea" },
  ],
  columns: () => [
    strong("number", "Offer", (r) => String(r.offer_number)),
    col("candidate", "Candidate", (r) => `${r.candidate_name} (${r.candidate_number})`),
    col("role", "For", (r) => String(r.opening_title)),
    badge("status", "Status", (r) => r.status),
    col("ctc", "Annual CTC", (r) => inr(r.annual_ctc)),
    col("join", "Joining", (r) => calendarDate(r.joining_date)),
    col("valid", "Valid until", (r) => calendarDate(r.valid_until)),
    link("emp", "Employee", (r) => String(r.employee_number ?? ""), () => `/hr/employees`),
  ],
  searchText: (r) => text(r, ["offer_number", "candidate_name", "opening_title", "status"]),
  rowActions: [
    { label: "Submit for approval", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "draft", run: (r) => act("offer-submit", { id: r.id }), success: "Submitted. A second person must approve it." },
    { label: "Approve", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("offer-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved." },
    { label: "Send back", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "pending_approval", run: (r, note) => act("offer-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Sent back to draft." },
    { label: "Send to candidate", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "approved", run: (r) => act("offer-send", { id: r.id }), success: "Marked as sent." },
    { label: "Accepted", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "sent", run: (r, note) => act("offer-decision", { id: r.id, accepted: true, note }), note: { label: "Note (optional)" }, success: "Offer accepted." },
    { label: "Declined", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "sent", run: (r, note) => act("offer-decision", { id: r.id, accepted: false, note }), note: { label: "Why they declined", required: true }, success: "Offer declined." },
    { label: "Withdraw", permission: "hr_payroll.compensation.manage", show: (r) => ["draft", "pending_approval", "approved", "sent"].includes(String(r.status)), run: (r, note) => act("offer-withdraw", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Withdrawn." },
    { label: "Convert to employee", permission: "hr_payroll.compensation.manage", show: (r) => r.status === "accepted" && !r.employee_id, run: (r) => act("offer-convert", { id: r.id }), success: "Employee created. Complete joining from Employees." },
  ],
};

export const RECRUITMENT_REGISTERS: Record<string, RegisterConfig> = {
  openings,
  candidates,
  applications,
  interviews,
  "my-interviews": myInterviews,
  offers,
};
