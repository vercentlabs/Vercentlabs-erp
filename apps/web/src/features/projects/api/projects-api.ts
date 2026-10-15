"use client";

// Projects: the client of /api/projects.
export class ProjectApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/projects${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new ProjectApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
export const send = <T = Record<string, unknown>>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });
export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof ProjectApiError ? error.status : 0);
export const errorCode = (error: unknown) => (error instanceof ProjectApiError ? error.code : undefined);
export const errorDetails = (error: unknown) => (error instanceof ProjectApiError ? error.details : {});
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export const PROJECTS_BASE = "/projects";
export type ProjectStatus = "DRAFT" | "PLANNED" | "IN_PROGRESS" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type Health = "ON_TRACK" | "AT_RISK" | "BLOCKED" | "UNKNOWN" | "COMPLETED" | "CANCELLED";
export type Priority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export const STATUS_TONE: Record<ProjectStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", PLANNED: "info", IN_PROGRESS: "info", ON_HOLD: "warning", COMPLETED: "success", CANCELLED: "neutral" };
export const HEALTH_TONE: Record<Health, "neutral" | "info" | "success" | "warning" | "danger"> = {
  ON_TRACK: "success", AT_RISK: "warning", BLOCKED: "danger", UNKNOWN: "neutral", COMPLETED: "success", CANCELLED: "neutral" };
export const PRIORITY_LABEL: Record<Priority, string> = { LOW: "Low", NORMAL: "Normal", HIGH: "High", URGENT: "Urgent" };
export const PRIORITY_TONE: Record<Priority, "neutral" | "info" | "warning" | "danger"> = { LOW: "neutral", NORMAL: "info", HIGH: "warning", URGENT: "danger" };

export type ProjectRow = {
  id: string; code: string; name: string | null; classification: "INTERNAL" | "CUSTOMER"; type: string | null; customer: string | null; customerId: string | null; managerId: string | null;
  manager: string | null; status: ProjectStatus; statusLabel: string; priority: Priority; plannedStartDate: string | null; targetEndDate: string | null; actualStartDate: string | null;
  completedAt: string | null; health: Health; healthLabel: string; healthReasons: string[]; progress: number | null; progressLabel: string; tags: string[]; members: number; archived: boolean;
  approval: string; targetIn: number | null; overdue: boolean; lastActivityAt: string | null; updatedAt: string;
  customerNumber: string | null; customerInactive: boolean; provisionalCustomer: boolean; customerReview: boolean;
};
export type ProjectList = { rows: ProjectRow[]; total: number; page: number; pageSize: number; pages: number; can: { create: boolean; export: boolean; viewAll: boolean } };
export type WorkCounts = { total: number; completed: number; open: number; overdue: number; overdueCritical?: number; openRequired?: number } | null;
export type Project = {
  id: string; code: string; name: string | null; description: string | null; classification: "INTERNAL" | "CUSTOMER"; typeId: string | null; type: string | null;
  customerId: string | null; customer: string | null; customerNumber: string | null; contact: { id: string; name: string; email: string | null; phone: string | null } | null;
  crmAccountId: string | null; customerStatus: string | null; customerInactive: boolean; customerReview: { reason: string; at: string } | null;
  managerId: string | null; manager: string | null; managerActive: boolean; status: ProjectStatus; statusLabel: string; previousStatus: ProjectStatus | null; priority: Priority; source: string;
  plannedStartDate: string | null; targetEndDate: string | null; actualStartDate: string | null; completedAt: string | null; completionNote: string | null; completedBy: string | null;
  cancelledAt: string | null; cancelReason: string | null; cancelledBy: string | null;
  approval: { status: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED"; requestedBy: string | null; requestedAt: string | null; approvedBy: string | null; approvedAt: string | null; note: string | null;
    required: boolean; mayDecide: boolean };
  risk: { flagged: boolean; note: string | null };
  health: { state: Health; label: string; reasons: string[]; final?: boolean; note: { text: string; at: string } | null; noteBy: string | null };
  progress: { state: "NO_DATA" | "TRACKED"; percent: number | null; label: string; tasks: WorkCounts; milestones: WorkCounts };
  hold: { reason: string; owner: string | null; startedAt: string } | null;
  activation: { ready: boolean; problems: Array<{ code: string; field: string; message: string }> } | null;
  tags: string[]; template: { id: string; name: string } | null; archived: boolean; archivedAt: string | null; archivedBy: string | null; members: number; createdBy: string | null; createdAt: string;
  updatedAt: string; lastActivityAt: string | null; version: number; role: string | null; roleLabel: string | null;
  can: Record<"edit" | "members" | "links" | "start" | "hold" | "resume" | "complete" | "reopen" | "cancel" | "archive" | "approve" | "contribute" | "financials" | "activate" | "restore" | "delete" | "customer", boolean>;
};
export type ActivityEntry = { id: string; action: string; summary: string | null; actor: string; at: string };
export type ProjectSummary = { project: Project; links: Array<{ type: string; label: string; count: number }>; activity: ActivityEntry[]; next: string };
export type Member = { id: string; userId: string; name: string; email: string; role: "MANAGER" | "MEMBER" | "VIEWER" | "FINANCIAL_VIEWER"; roleLabel: string; joinedAt: string; addedBy: string | null;
  leftAt: string | null; removedBy: string | null; removalNote: string | null; active: boolean; accountActive: boolean | null };
export type Link = { id: string; sourceModule: string; sourceType: string; typeLabel: string; sourceId: string; sourceLineId: string | null; linkType: string; note: string | null; createdAt: string;
  createdBy: string | null; record: { missing: true } | { restricted: true } | { number: string | null; title: string | null; status: string | null; billingStatus: string | null; paymentStatus: string | null;
    amount: string | null; outstanding: string | null; href: string } };
export type Note = { id: string; body: string; author: string | null; createdAt: string; editedAt: string | null; version: number; mine: boolean; mayRemove: boolean;
  customerContactId: string | null; customerContact: string | null };
export type ProjectFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string; uploadedBy: string | null };
export type Check = { key: string; label: string; state: "PASS" | "FAIL" | "WARN" | "NOT_TRACKED" | "TO_CONFIRM"; message: string; blocking: boolean };
export type Options = {
  types: Array<{ id: string; code: string; name: string }>; users: Array<{ id: string; name: string; email: string }>; priorities: Priority[]; roles: Array<{ code: string; name: string }>;
  settings: { activationApprovalRequired: boolean; selfApprovalAllowed: boolean; dueSoonDays: number; customerAcceptanceRequired: boolean; customerChangeApprovalRequired: boolean;
    primaryContactRequired: boolean; inactiveCustomerAllowed: boolean; milestoneSelfApprovalAllowed?: boolean; milestoneInternalApprovalDefault?: boolean;
    taskSelfReviewAllowed?: boolean; taskReviewDefault?: boolean; taskReminderDays?: number }; currentUserId: string;
  can: { create: boolean; viewAll: boolean; export: boolean; reports: boolean; settings: boolean; inviteUsers: boolean; customerAssign: boolean; customerExport: boolean; crmAccounts: boolean };
};
export type Overview = {
  counts: Record<"active" | "inProgress" | "onHold" | "overdue" | "dueSoon" | "atRisk" | "drafts" | "pendingApproval" | "completedThisMonth" | "mine" | "noManager", number>;
  attention: Array<ProjectRow & { reason: string }>; byStatus: Array<{ status: ProjectStatus; label: string; count: number }>;
  recent: Array<{ id: string; projectId: string; project: string; action: string; summary: string | null; actor: string; at: string }>; can: { create: boolean; reports: boolean; viewAll: boolean };
};
export type SavedView = { id: string; name: string; filters: Record<string, string>; isDefault: boolean };

export const listProjects = (filters: Record<string, string | number | undefined>) => call<ProjectList>(`${qs(filters)}`);
export const getProject = (id: string) => call<{ project: Project }>(`/${id}`).then((r) => r.project);
export const getSummary = (id: string) => call<{ summary: ProjectSummary }>(`/${id}/summary`).then((r) => r.summary);
export const getActivity = (id: string) => call<{ activity: ActivityEntry[] }>(`/${id}/activity`).then((r) => r.activity);
export const getStatusHistory = (id: string) => call<{ history: Array<{ action: string; from: string | null; to: string; reason: string | null; actor: string; at: string }> }>(`/${id}/status-history`).then((r) => r.history);
export const getCompletionCheck = (id: string) => call<{ check: { checks: Check[]; completionDate: string; ready: boolean } }>(`/${id}/completion-check`).then((r) => r.check);
export const getCancellationReview = (id: string) => call<{ review: { dependencies: Array<{ type: string; number: string | null; status: string | null; message: string }>; members: number; hold: string | null; notes: string[] } }>(`/${id}/cancellation-review`).then((r) => r.review);
export const createProject = (input: Record<string, unknown>) => send<{ projectId: string; projectCode: string; replayed?: boolean }>("", input);
export const updateProject = (id: string, input: Record<string, unknown>) => send<{ projectId: string; version: number; changed: string[] }>(`/${id}`, input, "PATCH");
export const projectAction = (id: string, action: string, input: Record<string, unknown> = {}) => send<{ projectId: string; status?: string; approval?: string }>(`/${id}/${action}`, input);
export const createFromSalesOrder = (salesOrderId: string, input: Record<string, unknown> = {}) => send<{ projectId: string; projectCode: string; replayed?: boolean }>("/from-sales-order", { salesOrderId, ...input });
export const getOptions = () => call<{ options: Options }>("/options").then((r) => r.options);
export type EligibleCustomer = { id: string; name: string; legalName: string | null; number: string | null; kind: "CUSTOMER" | "CRM_ACCOUNT"; city: string | null; state: string | null;
  status: string; inactive: boolean; salesBlocked: boolean; similarNames: boolean; selectable: boolean; note: string | null };
export const searchCustomers = (search: string, crmAccounts = false) => call<{ customers: EligibleCustomer[] }>(`/customers${qs({ search, crmAccounts: crmAccounts ? 1 : undefined })}`).then((r) => r.customers);
export const customerContacts = (customerId: string) => call<{ contacts: Array<{ id: string; name: string; email: string | null }> }>(`/customers/${customerId}/contacts`).then((r) => r.contacts);
export const getMembers = (id: string) => call<{ members: Member[]; can: { manage: boolean } }>(`/${id}/members`);
export const addMember = (id: string, userId: string, role: string) => send(`/${id}/members`, { userId, role });
export const changeMemberRole = (id: string, memberId: string, role: string) => send(`/${id}/members/${memberId}`, { role }, "PATCH");
export const removeMember = (id: string, memberId: string, input: { note?: string; reassignToUserId?: string; taskException?: string } = {}) => send(`/${id}/members/${memberId}`, input, "DELETE");
export const getLinks = (id: string) => call<{ links: Link[]; financials: boolean; can: { manage: boolean; types: Array<{ type: string; label: string }> } }>(`/${id}/links`);
export const searchLinkable = (id: string, type: string, search: string) => call<{ records: Array<{ id: string; number: string | null; title: string | null; status: string | null }> }>(`/${id}/link-search${qs({ type, search })}`).then((r) => r.records);
export const addLink = (id: string, input: Record<string, unknown>) => send(`/${id}/links`, input);
export const removeLink = (id: string, linkId: string) => send(`/${id}/links/${linkId}`, {}, "DELETE");
export const getNotes = (id: string) => call<{ notes: Note[]; can: { add: boolean } }>(`/${id}/notes`);
export const addNote = (id: string, body: string, customerContactId?: string | null) => send(`/${id}/notes`, { body, customerContactId: customerContactId || undefined });
export const editNote = (id: string, noteId: string, body: string, expectedVersion: number) => send(`/${id}/notes/${noteId}`, { body, expectedVersion }, "PATCH");
export const removeNote = (id: string, noteId: string) => send(`/${id}/notes/${noteId}`, {}, "DELETE");
export const getFiles = (id: string) => call<{ files: ProjectFile[] }>(`/${id}/files`).then((r) => r.files);
export async function uploadFile(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: ProjectFile }>(`/${id}/files`, { method: "POST", body: form }).then((r) => r.file);
}
export const removeFile = (id: string, fileId: string) => send(`/${id}/files/${fileId}`, {}, "DELETE");
export const fileHref = (id: string, fileId: string) => `/api/projects/${id}/files/${fileId}`;
export const getOverview = () => call<{ overview: Overview }>("/overview").then((r) => r.overview);
export const getReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/reports/overview${qs({ kind, ...filters })}`).then((r) => r.rows);
export const exportHref = (filters: Record<string, string | number | undefined>) => `/api/projects/export${qs(filters)}`;
export const importProjects = (csv: string, importKey: string) => send<{ results: Array<{ row: number; status: string; projectCode?: string; projectId?: string; code?: string; message?: string }>; created: number; failed: number }>("/import", { csv, importKey });
export const getViews = () => call<{ views: SavedView[] }>("/views").then((r) => r.views);
export const saveView = (input: { name: string; filters: Record<string, string>; isDefault?: boolean }) => send("/views", input);
export const deleteView = (id: string) => send(`/views/${id}`, {}, "DELETE");
export const getSettings = () => call<{ settings: Options["settings"]; types: Array<{ id: string; code: string; name: string; description: string | null; status: string }>; roles: Array<{ code: string; name: string }>; can: { manage: boolean } }>("/settings");
export const saveSettings = (input: Record<string, unknown>) => send("/settings", input, "PUT");
export const saveType = (input: Record<string, unknown>) => send("/settings/types", input);

export const dateLabel = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
export const targetLabel = (row: { targetIn: number | null; status: ProjectStatus }) => (row.targetIn === null || !["PLANNED", "IN_PROGRESS", "ON_HOLD"].includes(row.status) ? null
  : row.targetIn < 0 ? `${-row.targetIn} day(s) overdue` : row.targetIn === 0 ? "Due today" : `${row.targetIn} day(s) left`);

// ------------------------------------------------------------------ Customer Association
export type CustomerAddress = { id: string; type: string; label: string | null; line1: string; line2: string | null; city: string; district: string | null; state: string | null; stateCode: string | null;
  postalCode: string | null; countryCode: string; gstin: string | null; defaultBilling: boolean; defaultShipping: boolean; primary: boolean };
export type ProjectContact = { id: string; contactId: string; name: string; designation: string | null; role: ContactRole; roleLabel: string; title: string | null; primary: boolean;
  email: string | null; phone: string | null; active: boolean; contactStatus: string; relatedToCustomer: boolean; addedBy: string | null; addedAt: string; removedBy: string | null;
  removedAt: string | null; removalNote: string | null; version: number };
export type ContactRole = "PRIMARY" | "SPONSOR" | "TECHNICAL" | "BILLING" | "APPROVAL" | "OTHER";
export const CONTACT_ROLE_LABEL: Record<ContactRole, string> = { PRIMARY: "Primary Contact", SPONSOR: "Project Sponsor", TECHNICAL: "Technical Contact", BILLING: "Billing Contact",
  APPROVAL: "Approval Contact", OTHER: "Other" };
export type ProjectSite = { id: string; name: string; sourceAddressId: string | null; line1: string; line2: string | null; city: string; district: string | null; state: string | null;
  stateCode: string | null; postalCode: string | null; countryCode: string; primary: boolean; active: boolean; createdAt: string; updatedAt: string; removedAt: string | null; version: number };
export type ChangeReview = { blocking: Array<{ code: string; message: string }>; warnings: Array<{ code: string; message: string }> };
export type ProjectCustomer = {
  projectId: string; code: string; status: ProjectStatus; classification: "INTERNAL" | "CUSTOMER"; version: number;
  customer: { id: string; name: string; legalName: string | null; number: string | null; code: string | null; status: string; inactive: boolean; merged: { id: string; name: string } | null;
    salesBlocked: boolean; salesBlockReason: string | null; tax: { gstin: string | null; stateCode: string | null; state: string | null; placeOfSupply: string | null; treatment: string | null };
    phone: string | null; email: string | null; addresses: CustomerAddress[]; projects: { total: number; active: number } | null } | null;
  provisional: { id: string; name: string; status: string; nowCustomer: boolean; mergedInto: { id: string; name: string } | null } | null;
  contacts: ProjectContact[]; sites: ProjectSite[]; primaryContactRequired: boolean; gstStates: Array<{ code: string; name: string }>; salesLinks: Array<{ type: string; count: number }>;
  review: { reason: string; at: string } | null;
  changeRequest: { id: string; toCustomerId: string; toCustomer: string; reason: string; review: ChangeReview; requestedBy: string | null; requestedById: string; requestedAt: string } | null;
  changeApprovalRequired: boolean;
  can: Record<"view" | "assign" | "change" | "approve" | "contacts" | "sites" | "salesLink" | "history" | "review" | "resolveMapping" | "approveRequest" | "withdrawRequest", boolean>;
};
export type CustomerHistoryEntry = { id: string; type: string; summary: string; reason: string | null; from: string | null; to: string | null; contact: string | null; actor: string; at: string };
export const getProjectCustomer = (id: string) => call<{ customer: ProjectCustomer }>(`/${id}/customer`).then((r) => r.customer);
export const assignCustomer = (id: string, input: Record<string, unknown>) => send(`/${id}/customer`, input, "PUT");
export const customerAction = (id: string, action: string, input: Record<string, unknown> = {}) => send<{ status?: string; requestId?: string }>(`/${id}/customer/${action}`, input);
export const getCustomerHistory = (id: string) => call<{ history: CustomerHistoryEntry[] }>(`/${id}/customer/history`).then((r) => r.history);
export const previewCustomerChange = (id: string, toCustomerId: string) => call<{ review: ChangeReview & { approvalRequired: boolean; toCustomer: { id: string; name: string; inactive: boolean } } }>(
  `/${id}/customer/change-preview${qs({ toCustomerId })}`).then((r) => r.review);
export const decideCustomerChange = (id: string, requestId: string, input: { action: "decide" | "withdraw"; decision?: "APPROVE" | "REJECT"; note?: string }) =>
  send(`/${id}/customer/change-requests/${requestId}`, input);
export const eligibleContacts = (id: string, search = "") => call<{ contacts: Array<{ id: string; name: string; email: string | null; designation: string | null }> }>(
  `/${id}/customer/eligible-contacts${qs({ search })}`).then((r) => r.contacts);
export const getProjectContacts = (id: string, includeRemoved = false) => call<{ contacts: ProjectContact[]; can: { manage: boolean } }>(`/${id}/customer/contacts${qs({ removed: includeRemoved ? 1 : undefined })}`);
export const addProjectContact = (id: string, input: { contactId: string; role: ContactRole; title?: string; replacePrimary?: boolean }) => send(`/${id}/customer/contacts`, input);
export const updateProjectContact = (id: string, rowId: string, input: Record<string, unknown>) => send(`/${id}/customer/contacts/${rowId}`, input, "PATCH");
export const replaceProjectContact = (id: string, rowId: string, input: { contactId: string; note?: string }) => send(`/${id}/customer/contacts/${rowId}`, input);
export const removeProjectContact = (id: string, rowId: string, note?: string) => send(`/${id}/customer/contacts/${rowId}`, { note }, "DELETE");
export const getProjectSites = (id: string, includeRemoved = false) => call<{ sites: ProjectSite[]; can: { manage: boolean } }>(`/${id}/customer/sites${qs({ removed: includeRemoved ? 1 : undefined })}`);
export const addProjectSite = (id: string, input: Record<string, unknown>) => send(`/${id}/customer/sites`, input);
export const updateProjectSite = (id: string, siteId: string, input: Record<string, unknown>) => send(`/${id}/customer/sites/${siteId}`, input, "PATCH");
export const removeProjectSite = (id: string, siteId: string) => send(`/${id}/customer/sites/${siteId}`, {}, "DELETE");
export const customerExportHref = (customerId?: string) => `/api/projects/customers/export${qs({ customerId })}`;

// ------------------------------------------------------------------ Milestones
export type MilestoneStatus = "NOT_STARTED" | "IN_PROGRESS" | "BLOCKED" | "SUBMITTED" | "COMPLETED" | "CANCELLED";
export type ApprovalStatus = "NOT_REQUIRED" | "NOT_SUBMITTED" | "PENDING" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED";
export const MILESTONE_TONE: Record<MilestoneStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", BLOCKED: "danger", SUBMITTED: "warning", COMPLETED: "success", CANCELLED: "neutral" };
export const APPROVAL_TONE: Record<ApprovalStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  NOT_REQUIRED: "neutral", NOT_SUBMITTED: "neutral", PENDING: "warning", CHANGES_REQUESTED: "danger", APPROVED: "success", REJECTED: "danger" };
export const MILESTONE_TYPE_LABEL: Record<string, string> = { DELIVERABLE: "Deliverable", APPROVAL: "Approval", PHASE_GATE: "Phase gate", OTHER: "Other" };
export const BLOCKER_LABEL: Record<string, string> = { CUSTOMER_FEEDBACK: "Customer feedback pending", TASK_DELAYED: "Required task delayed", DOCUMENT_MISSING: "Required document missing",
  DEPENDENCY: "Dependency incomplete", RESOURCE: "Resource unavailable", APPROVAL: "Approval pending", OTHER: "Other" };
export type MilestoneRow = {
  id: string; code: string; name: string; projectId: string; type: string; typeLabel: string; ownerId: string; owner: string | null; status: MilestoneStatus; statusLabel: string;
  approvalStatus: ApprovalStatus; approvalLabel: string; priority: Priority; sequence: number; plannedStartDate: string | null; originalDueDate: string; dueDate: string; completedAt: string | null;
  rescheduled: boolean; overdue: boolean; dueIn: number | null; requiredForCompletion: boolean; waived: boolean; customerAcceptanceRequired: boolean; internalApprovalRequired: boolean; version: number;
  projectCode?: string; projectName?: string | null;
  criteria?: { total: number; done: number; percent: number | null }; prerequisiteIds?: string[]; openBlockers?: number;
};
export type ProjectMilestones = {
  projectId: string; projectCode: string; projectStatus: ProjectStatus; targetEndDate: string | null; plannedStartDate: string | null; classification: "INTERNAL" | "CUSTOMER";
  milestones: MilestoneRow[]; summary: { total: number; completed: number; overdue: number; blocked: number; pendingApproval: number };
  can: { create: boolean; export: boolean }; tasksTracked: boolean;
};
export type MilestoneCheck = { key: string; label: string; state: "PASS" | "FAIL" | "NOT_TRACKED" | "WAIVED"; message: string; blocking: boolean };
export type MilestoneDecision = { id: string; reviewerType: "INTERNAL" | "CUSTOMER"; decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED"; note: string | null; recordedBy: string | null;
  recordedAt: string; customerContact: string | null; customerDecisionDate: string | null; evidenceFileId: string | null; evidenceFile: string | null; evidenceReference: string | null };
export type BillingStage = { salesOrderId: string; number: string; status: string; billingStatus: string | null; href: string; reference: string | null;
  line: null | { missing: true } | { id: string; sequence: number; item: string | null; description: string | null; current: boolean; amount: string | null } };
export type MilestoneDetail = MilestoneRow & {
  description: string | null; projectCode: string; projectName: string | null; projectStatus: ProjectStatus; projectClassification: "INTERNAL" | "CUSTOMER"; projectTargetEndDate: string | null;
  projectManager: string | null; customerContactId: string | null; customerContact: string | null; startedAt: string | null; submittedAt: string | null; completedBy: string | null;
  cancelledAt: string | null; cancelReason: string | null; cancelledBy: string | null; waiver: { at: string; by: string | null; reason: string } | null; createdBy: string | null; createdAt: string;
  updatedAt: string; scopeVersion: number; previousStatus: MilestoneStatus | null;
  criteria: Array<{ id: string; sequence: number; description: string; required: boolean; evidenceRequired: boolean; status: "PENDING" | "COMPLETED" | "WAIVED"; evidenceFileId: string | null;
    evidenceFile: string | null; evidenceNote: string | null; completedBy: string | null; completedAt: string | null; waivedBy: string | null; waivedAt: string | null; waiverReason: string | null; version: number }>;
  criteriaProgress: { total: number; done: number; percent: number | null };
  tasks: Array<{ linkId: string; taskId: string; required: boolean; disposition: string | null; task: { title: string; code: string | null; status: string; completed: boolean; cancelled: boolean } | null }> | null;
  taskProgress: { tracked: boolean; total: number; completed: number; percent: number | null; label: string };
  prerequisites: Array<{ dependencyId: string; id: string; code: string; name: string; status: MilestoneStatus; statusLabel: string; dueDate: string }>;
  dependents: Array<{ dependencyId: string; id: string; code: string; name: string; status: MilestoneStatus; statusLabel: string }>;
  blockers: Array<{ id: string; category: string; categoryLabel: string; description: string; owner: string | null; ownerId: string | null; status: "OPEN" | "RESOLVED"; resolution: string | null;
    raisedBy: string | null; raisedAt: string; resolvedBy: string | null; resolvedAt: string | null }>;
  submissions: Array<{ id: string; number: number; scopeVersion: number; note: string | null; submittedBy: string | null; submittedAt: string; current: boolean; stale: boolean;
    snapshot: Record<string, unknown>; decisions: MilestoneDecision[] }>;
  readiness: { ready: boolean; checks: MilestoneCheck[] };
  billing: { stage: null | { restricted: true } | { missing: true } | BillingStage;
    amountsVisible: boolean; request: null | { id?: string; status: "OPEN" | "ACKNOWLEDGED" | "WITHDRAWN"; requestedBy?: string | null; requestedAt?: string; note?: string | null;
      closedBy?: string | null; closedAt?: string | null; closeNote?: string | null } };
  files: Array<{ id: string; fileName: string }>;
  can: Record<"edit" | "assign" | "links" | "work" | "evidence" | "start" | "block" | "submit" | "withdraw" | "approve" | "customerAcceptance" | "complete" | "reopen" | "cancel" | "waive"
    | "waiveForCompletion" | "billingStage" | "billingRequest" | "billingWithdraw" | "billingAcknowledge" | "note" | "viewBilling", boolean>;
  tasksTracked: boolean;
};
export type MilestoneQueue = { rows: MilestoneRow[]; total: number; page: number; pageSize: number; pages: number; can: { export: boolean } };
export type MilestoneActivity = { id: string; action: string; summary: string | null; from: string | null; to: string | null; actor: string; at: string };
export const MILESTONES_BASE = "/projects/milestones";
export const getProjectMilestones = (projectId: string) => call<ProjectMilestones>(`/${projectId}/milestones`);
export const createMilestone = (projectId: string, input: Record<string, unknown>) => send<{ milestoneId: string; milestoneCode: string; replayed?: boolean }>(`/${projectId}/milestones`, input);
export const getMilestone = (id: string) => call<MilestoneDetail>(`/milestones/${id}`);
export const updateMilestone = (id: string, input: Record<string, unknown>) => send<{ milestoneId: string; changed: string[] }>(`/milestones/${id}`, input, "PATCH");
export const milestoneAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/milestones/${id}/${action}`, input);
export const getMilestoneActivity = (id: string) => call<{ activity: MilestoneActivity[] }>(`/milestones/${id}/activity`).then((r) => r.activity);
export const getMilestoneNotes = (id: string) => call<{ notes: Array<{ id: string; body: string; author: string | null; createdAt: string; mine: boolean }> }>(`/milestones/${id}/notes`).then((r) => r.notes);
export const searchMilestoneTasks = (id: string, search: string) => call<{ tasks: { tracked: boolean; tasks: Array<{ id: string; title: string; code?: string | null; status?: string }> } }>(
  `/milestones/${id}/task-search${qs({ search })}`).then((r) => r.tasks);
export const listMilestoneQueue = (filters: Record<string, string | number | undefined>) => call<MilestoneQueue>(`/milestones${qs(filters)}`);
export const milestoneExportHref = (filters: Record<string, string | number | undefined>) => `/api/projects/milestones/export${qs(filters)}`;
export const getMilestoneReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/reports/milestones${qs({ kind, ...filters })}`).then((r) => r.rows);
export async function uploadMilestoneFile(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: ProjectFile }>(`/milestones/${id}/files`, { method: "POST", body: form }).then((r) => r.file);
}
export const getMilestoneFiles = (id: string) => call<{ files: ProjectFile[] }>(`/milestones/${id}/files`).then((r) => r.files);
export const removeMilestoneFile = (id: string, fileId: string) => send(`/milestones/${id}/files/${fileId}`, {}, "DELETE");
export const milestoneFileHref = (id: string, fileId: string) => `/api/projects/milestones/${id}/files/${fileId}`;
export const dueLabel = (row: { dueIn: number | null; overdue: boolean }) => (row.dueIn === null ? null : row.overdue ? `${-row.dueIn} day(s) overdue` : row.dueIn === 0 ? "Due today" : `Due in ${row.dueIn} day(s)`);

// ------------------------------------------------------------------ Tasks
export type TaskStatus = "TO_DO" | "IN_PROGRESS" | "BLOCKED" | "IN_REVIEW" | "DONE" | "CANCELLED";
export type TaskApproval = "NOT_REQUIRED" | "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";
export const TASK_TONE: Record<TaskStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  TO_DO: "neutral", IN_PROGRESS: "info", BLOCKED: "danger", IN_REVIEW: "warning", DONE: "success", CANCELLED: "neutral" };
export const TASK_STATUS_TEXT: Record<TaskStatus, string> = { TO_DO: "To do", IN_PROGRESS: "In progress", BLOCKED: "Blocked", IN_REVIEW: "In review", DONE: "Done", CANCELLED: "Cancelled" };
export const TASK_TYPE_LABEL: Record<string, string> = { GENERAL: "General", DESIGN: "Design", BUILD: "Build", CONFIGURATION: "Configuration", DATA: "Data", TESTING: "Testing",
  DOCUMENTATION: "Documentation", MEETING: "Meeting", OTHER: "Other" };
export const TASK_BLOCKER_LABEL: Record<string, string> = { CUSTOMER_RESPONSE: "Waiting for customer response", MISSING_REQUIREMENTS: "Missing requirements", WAITING_ON_TASK: "Awaiting another task",
  RESOURCE: "Resource unavailable", APPROVAL: "Pending approval", TECHNICAL: "Technical problem", OTHER: "Other" };
export type TaskRow = {
  id: string; code: string; title: string; projectId: string; milestoneId: string | null; assigneeId: string; assignee: string | null; status: TaskStatus; statusLabel: string;
  approvalStatus: TaskApproval; approvalLabel: string; priority: Priority; type: string; typeLabel: string; tags: string[]; plannedStartDate: string | null; dueDate: string; originalDueDate: string;
  rescheduled: boolean; completedAt: string | null; reviewRequired: boolean; estimateMinutes: number | null; archived: boolean; overdue: boolean; dueIn: number | null; updatedAt: string; version: number;
  projectCode?: string; projectName?: string | null; projectStatus?: ProjectStatus; milestone?: { id: string; code: string; name: string } | null; checklist?: { total: number; done: number };
};
export type TaskQueue = { rows: TaskRow[]; total: number; page: number; pageSize: number; pages: number; can: { export: boolean; bulk: boolean } };
export type ProjectTasks = TaskQueue & {
  projectId: string; projectCode: string; projectStatus: ProjectStatus; targetEndDate: string | null; milestones: Array<{ id: string; code: string; name: string; status: string; linkable: boolean }>;
  summary: { total: number; done: number; open: number; blocked: number; inReview: number; overdue: number; percent: number | null };
  can: { export: boolean; bulk: boolean; create: boolean }; reviewDefault: boolean;
};
export type TaskCheck = { key: string; label: string; state: "PASS" | "FAIL" | "WAIVED"; message: string; blocking: boolean };
export type TaskDetail = TaskRow & {
  description: string | null; projectCode: string; projectName: string | null; projectStatus: ProjectStatus; projectManager: string | null; customer: { name: string; contact: string | null } | null;
  milestone: { id: string; code: string; name: string; status: string; statusLabel: string } | null; reporter: string | null; reviewerId: string | null; reviewer: string | null;
  evidenceRequired: boolean; completionNote: string | null; evidenceReference: string | null; actualStartedAt: string | null; completedBy: string | null; cancelledAt: string | null;
  cancelReason: string | null; cancelledBy: string | null; archivedAt: string | null; templateRef: string | null; scopeVersion: number; previousStatus: TaskStatus | null; createdAt: string;
  checklist: Array<{ id: string; title: string; required: boolean; status: "PENDING" | "DONE" | "WAIVED"; position: number; note: string | null; completedBy: string | null; completedAt: string | null;
    waivedBy: string | null; waiverReference: string | null; version: number }>;
  checklistProgress: { total: number; done: number; percent: number | null };
  prerequisites: Array<{ dependencyId: string; id: string; code: string; title: string; status: TaskStatus; statusLabel: string; dueDate: string }>;
  dependents: Array<{ dependencyId: string; id: string; code: string; title: string; status: TaskStatus; statusLabel: string }>;
  blockers: Array<{ id: string; reason: string; reasonLabel: string; description: string; ownerId: string; owner: string | null; status: "ACTIVE" | "RESOLVED"; resolution: string | null;
    raisedBy: string | null; raisedAt: string; resolvedBy: string | null; resolvedAt: string | null }>;
  reviews: Array<{ id: string; number: number; note: string | null; submittedBy: string | null; submittedAt: string; current: boolean; stale: boolean; snapshot: Record<string, unknown>;
    decision: { decision: "APPROVED" | "CHANGES_REQUESTED" | "REJECTED"; reason: string | null; decidedBy: string | null; decidedAt: string } | null }>;
  files: Array<{ id: string; fileName: string; uploadedBy: string | null; uploadedAt: string }>;
  records: Array<{ key: string; label: string; count: number; summary: string | null }>;
  readiness: { ready: boolean; checks: TaskCheck[] };
  can: Record<"edit" | "assign" | "start" | "startByException" | "block" | "resolveBlocker" | "checklist" | "manageChecklist" | "waive" | "complete" | "submit" | "withdraw" | "approve" | "requestChanges"
    | "reopen" | "cancel" | "archive" | "restore" | "comment" | "evidence" | "dependencies", boolean>;
};
export type TaskActivity = { id: string; action: string; summary: string | null; from: string | null; to: string | null; actor: string; at: string };
export type TaskComment = { id: string; body: string; author: string | null; mine: boolean; createdAt: string; mentions: string[] };
export type TaskBulkResult = { results: Array<{ taskId: string; code: string | null; ok: boolean; status?: string | null; replayed?: boolean; error?: { code: string; message: string } }>;
  succeeded: number; failed: number; summary: string };
export const TASKS_BASE = "/projects/tasks";
export const getProjectTasks = (projectId: string, filters: Record<string, string | number | undefined> = {}) => call<ProjectTasks>(`/${projectId}/tasks${qs(filters)}`);
export const getTaskProgress = (projectId: string, weeks = 12) => call<{ points: Array<{ date: string; total: number; done: number; percent: number | null }> }>(`/${projectId}/tasks/progress${qs({ weeks })}`).then((r) => r.points);
export const createTask = (projectId: string, input: Record<string, unknown>) => send<{ taskId: string; taskCode: string; replayed?: boolean }>(`/${projectId}/tasks`, input);
export const getTask = (id: string) => call<TaskDetail>(`/tasks/${id}`);
export const updateTask = (id: string, input: Record<string, unknown>) => send<{ taskId: string; changed: string[] }>(`/tasks/${id}`, input, "PATCH");
export const taskAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/tasks/${id}/${action}`, input);
export const getTaskActivity = (id: string) => call<{ activity: TaskActivity[] }>(`/tasks/${id}/activity`).then((r) => r.activity);
export const getTaskComments = (id: string) => call<{ comments: TaskComment[] }>(`/tasks/${id}/comments`).then((r) => r.comments);
export const listTasks = (filters: Record<string, string | number | undefined>) => call<TaskQueue>(`/tasks${qs(filters)}`);
export const bulkTasks = (input: Record<string, unknown>) => send<TaskBulkResult>("/tasks/bulk", input);
export const taskExportHref = (filters: Record<string, string | number | undefined>) => `/api/projects/tasks/export${qs(filters)}`;
export const getTaskViews = () => call<{ views: SavedView[] }>("/tasks/views").then((r) => r.views);
export const saveTaskView = (input: { name: string; filters: Record<string, string>; isDefault?: boolean }) => send("/tasks/views", input);
export const deleteTaskView = (id: string) => send(`/tasks/views/${id}`, {}, "DELETE");
export const getTaskReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) => call<{ rows: T[] }>(`/reports/tasks${qs({ kind, ...filters })}`).then((r) => r.rows);
export async function uploadTaskFile(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: ProjectFile }>(`/tasks/${id}/files`, { method: "POST", body: form }).then((r) => r.file);
}
export const removeTaskFile = (id: string, fileId: string) => send(`/tasks/${id}/files/${fileId}`, {}, "DELETE");
export const taskFileHref = (id: string, fileId: string) => `/api/projects/tasks/${id}/files/${fileId}`;
export const minutesLabel = (minutes: number | null | undefined) => (!minutes ? "—" : minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`);
