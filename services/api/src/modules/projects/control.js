// Control and collaboration (F224-F227): issues, risks with a probability x impact score and a path to a
// realised issue, documents with confidentiality, and comments with mentions on any project entity.
import {
  assertOpen, canSeeFinance, dateOrNull, has, isBroad, isMember, loadProject, need, nextNumber, oneOf, ProjectError, qx, recordEvent, requiredText, textOrNull, uuid, uuidOrNull,
} from "./common.js";

// A confidential document exists only for its author, the project manager, approvers and auditors.
const canSeeDocument = (c, p, d) => !d.confidential || d.created_by === c.userId || isPm(c, p) || has(c, "projects.audit.view") || canSeeFinance(c);
const isPm = (c, p) => p.project_manager_id === c.userId || has(c, "projects.manage") || has(c, "projects.approve");
async function requireContributor(client, c, p) {
  need(c, "projects.view");
  if (has(c, "projects.manage") || has(c, "projects.tasks.manage") || p.project_manager_id === c.userId) return;
  if (!(await isMember(client, c, p.id))) throw new ProjectError(403, "Only the project team can add to it.", "PROJECT_FORBIDDEN");
}

async function checkLinks(client, p, input) {
  const taskId = uuidOrNull(input.taskId, "Task");
  if (taskId && !(await client.query(`SELECT 1 FROM tenant.project_tasks WHERE id=$1 AND project_id=$2`, [taskId, p.id])).rows[0]) throw new ProjectError(409, "The task is not in this project.", "PROJECT_REFERENCE_INVALID");
  const milestoneId = uuidOrNull(input.milestoneId, "Milestone");
  if (milestoneId && !(await client.query(`SELECT 1 FROM tenant.project_milestones WHERE id=$1 AND project_id=$2`, [milestoneId, p.id])).rows[0]) throw new ProjectError(409, "The milestone is not in this project.", "PROJECT_REFERENCE_INVALID");
  return { taskId, milestoneId };
}

// ------------------------------------------------------------------ issues (F224)
export async function listProjectIssues(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filters.projectId) add("i.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.status && filters.status !== "all") add("i.status=?", oneOf(filters.status, ["open", "in_progress", "resolved", "closed"], "Status"));
  if (filters.severity) add("i.severity=?", oneOf(filters.severity, ["low", "medium", "high", "critical"], "Severity"));
  if (filters.mine === true || filters.mine === "true") add("i.owner_user_id=?", c.userId);
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=? AND m.active=true))", c.userId);
  const res = await qx(client, `SELECT i.*,p.project_number,p.name AS project_name,u.full_name AS owner_name FROM tenant.project_issues i JOIN tenant.projects p ON p.id=i.project_id LEFT JOIN public.users u ON u.id=i.owner_user_id WHERE i.organization_id=$1 AND i.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY CASE i.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,i.created_at DESC LIMIT 500`, values);
  return res.rows;
}

export async function createProjectIssue(client, c, projectId, input) {
  const p = await loadProject(client, c, projectId, { lock: true });
  await requireContributor(client, c, p);
  assertOpen(p, "raise issues");
  const { taskId, milestoneId } = await checkLinks(client, p, input);
  const owner = uuidOrNull(input.ownerUserId, "Owner");
  if (owner && !(await isMember(client, c, p.id, owner))) throw new ProjectError(409, "An issue can only be owned by someone on the project team.", "PROJECT_ASSIGNEE_INVALID");
  const number = await nextNumber(client, c, "project_issue", "ISS");
  const res = await qx(client, `INSERT INTO tenant.project_issues(organization_id,company_id,project_id,issue_number,title,description,severity,owner_user_id,task_id,milestone_id,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.organizationId, c.companyId, p.id, number, requiredText(input.title, "Title", 300), textOrNull(input.description, 3000), oneOf(input.severity || "medium", ["low", "medium", "high", "critical"], "Severity"), owner, taskId, milestoneId, dateOrNull(input.dueDate, "Due date"), c.userId]);
  await recordEvent(client, c, "issue", res.rows[0].id, "project.issue.created", { projectId: p.id, severity: res.rows[0].severity });
  return res.rows[0];
}

export async function updateProjectIssue(client, c, issueId, input) {
  need(c, "projects.view");
  const i = (await qx(client, `SELECT * FROM tenant.project_issues WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(issueId, "Issue")])).rows[0];
  if (!i) throw new ProjectError(404, "Issue was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, i.project_id, { lock: true });
  if (i.owner_user_id !== c.userId && !isPm(c, p) && !has(c, "projects.tasks.manage")) throw new ProjectError(403, "Only the owner or a project manager can change an issue.", "PROJECT_FORBIDDEN");
  if (i.status === "closed") throw new ProjectError(409, "A closed issue is final; raise a new one.", "PROJECT_STATE_INVALID");
  const sets = []; const vals = [i.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (input.title !== undefined) set("title", requiredText(input.title, "Title", 300));
  if (input.description !== undefined) set("description", textOrNull(input.description, 3000));
  if (input.severity !== undefined) set("severity", oneOf(input.severity, ["low", "medium", "high", "critical"], "Severity"));
  if (input.dueDate !== undefined) set("due_date", dateOrNull(input.dueDate, "Due date"));
  if (input.ownerUserId !== undefined) {
    const owner = uuidOrNull(input.ownerUserId, "Owner");
    if (owner && !(await isMember(client, c, p.id, owner))) throw new ProjectError(409, "An issue can only be owned by someone on the project team.", "PROJECT_ASSIGNEE_INVALID");
    set("owner_user_id", owner);
  }
  if (input.status !== undefined) {
    const to = oneOf(input.status, ["open", "in_progress", "resolved", "closed"], "Status");
    const allowed = { open: ["in_progress", "resolved"], in_progress: ["open", "resolved"], resolved: ["in_progress", "closed"] };
    if (to !== i.status && !allowed[i.status]?.includes(to)) throw new ProjectError(409, `A ${i.status.replace("_", " ")} issue cannot move to ${to.replace("_", " ")}.`, "PROJECT_STATE_INVALID");
    if (to === "resolved" && !textOrNull(input.resolution ?? i.resolution, 3000)) throw new ProjectError(400, "Record how the issue was resolved.", "PROJECT_FIELD_REQUIRED");
    if (to === "closed" && !isPm(c, p)) throw new ProjectError(403, "Only a project manager can close an issue.", "PROJECT_FORBIDDEN");
    set("status", to);
    if (to === "resolved") set("resolved_at", new Date());
    if (to === "in_progress" && i.status === "resolved") set("resolved_at", null);
  }
  if (input.resolution !== undefined) set("resolution", textOrNull(input.resolution, 3000));
  if (!sets.length) return i;
  const res = await qx(client, `UPDATE tenant.project_issues SET ${sets.join(",")},updated_at=now() WHERE id=$1 RETURNING *`, vals);
  await recordEvent(client, c, "issue", i.id, "project.issue.updated", { status: res.rows[0].status });
  return res.rows[0];
}

// ------------------------------------------------------------------ risks (F225)
export async function listProjectRisks(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filters.projectId) add("r.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.status && filters.status !== "all") add("r.status=?", oneOf(filters.status, ["identified", "assessed", "mitigating", "realized", "closed"], "Status"));
  if (filters.minScore) add("r.score>=?", Number(filters.minScore));
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=? AND m.active=true))", c.userId);
  const res = await qx(client, `SELECT r.*,p.project_number,p.name AS project_name,u.full_name AS owner_name,CASE WHEN r.score>=15 THEN 'high' WHEN r.score>=8 THEN 'medium' ELSE 'low' END AS rating FROM tenant.project_risks r JOIN tenant.projects p ON p.id=r.project_id LEFT JOIN public.users u ON u.id=r.owner_user_id WHERE r.organization_id=$1 AND r.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY r.score DESC,r.created_at DESC LIMIT 500`, values);
  return res.rows;
}

export async function createProjectRisk(client, c, projectId, input) {
  const p = await loadProject(client, c, projectId, { lock: true });
  await requireContributor(client, c, p);
  assertOpen(p, "register risks");
  const probability = Math.round(Number(input.probability));
  const impact = Math.round(Number(input.impact));
  if (![probability, impact].every((n) => Number.isInteger(n) && n >= 1 && n <= 5)) throw new ProjectError(400, "Probability and impact are each scored 1 to 5.", "PROJECT_NUMBER_INVALID");
  const owner = uuidOrNull(input.ownerUserId, "Owner");
  if (owner && !(await isMember(client, c, p.id, owner))) throw new ProjectError(409, "A risk can only be owned by someone on the project team.", "PROJECT_ASSIGNEE_INVALID");
  const { taskId } = await checkLinks(client, p, input);
  const number = await nextNumber(client, c, "project_risk", "RSK");
  const res = await qx(client, `INSERT INTO tenant.project_risks(organization_id,company_id,project_id,risk_number,title,description,probability,impact,status,owner_user_id,mitigation,contingency,review_date,task_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'identified',$9,$10,$11,$12,$13,$14) RETURNING *`,
    [c.organizationId, c.companyId, p.id, number, requiredText(input.title, "Title", 300), textOrNull(input.description, 3000), probability, impact, owner, textOrNull(input.mitigation, 3000), textOrNull(input.contingency, 3000), dateOrNull(input.reviewDate, "Review date"), taskId, c.userId]);
  await recordEvent(client, c, "risk", res.rows[0].id, "project.risk.created", { projectId: p.id, score: res.rows[0].score });
  return res.rows[0];
}

export async function updateProjectRisk(client, c, riskId, input) {
  need(c, "projects.view");
  const r = (await qx(client, `SELECT * FROM tenant.project_risks WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(riskId, "Risk")])).rows[0];
  if (!r) throw new ProjectError(404, "Risk was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, r.project_id, { lock: true });
  if (r.owner_user_id !== c.userId && !isPm(c, p)) throw new ProjectError(403, "Only the owner or a project manager can change a risk.", "PROJECT_FORBIDDEN");
  if (["realized", "closed"].includes(r.status)) throw new ProjectError(409, `A ${r.status} risk is final.`, "PROJECT_STATE_INVALID");
  const sets = []; const vals = [r.id];
  const set = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (input.title !== undefined) set("title", requiredText(input.title, "Title", 300));
  if (input.description !== undefined) set("description", textOrNull(input.description, 3000));
  if (input.mitigation !== undefined) set("mitigation", textOrNull(input.mitigation, 3000));
  if (input.contingency !== undefined) set("contingency", textOrNull(input.contingency, 3000));
  if (input.reviewDate !== undefined) set("review_date", dateOrNull(input.reviewDate, "Review date"));
  if (input.probability !== undefined) { const n = Math.round(Number(input.probability)); if (!(n >= 1 && n <= 5)) throw new ProjectError(400, "Probability is scored 1 to 5.", "PROJECT_NUMBER_INVALID"); set("probability", n); }
  if (input.impact !== undefined) { const n = Math.round(Number(input.impact)); if (!(n >= 1 && n <= 5)) throw new ProjectError(400, "Impact is scored 1 to 5.", "PROJECT_NUMBER_INVALID"); set("impact", n); }
  const owner = input.ownerUserId !== undefined ? uuidOrNull(input.ownerUserId, "Owner") : r.owner_user_id;
  if (input.ownerUserId !== undefined) {
    if (owner && !(await isMember(client, c, p.id, owner))) throw new ProjectError(409, "A risk can only be owned by someone on the project team.", "PROJECT_ASSIGNEE_INVALID");
    set("owner_user_id", owner);
  }
  if (input.status !== undefined) {
    const to = oneOf(input.status, ["identified", "assessed", "mitigating", "closed"], "Status");
    const mitigation = input.mitigation !== undefined ? textOrNull(input.mitigation, 3000) : r.mitigation;
    const prob = input.probability !== undefined ? Math.round(Number(input.probability)) : r.probability;
    const imp = input.impact !== undefined ? Math.round(Number(input.impact)) : r.impact;
    if (["assessed", "mitigating"].includes(to) && prob * imp >= 15 && (!owner || !mitigation)) throw new ProjectError(409, "A high risk (score 15 or more) needs an owner and a mitigation plan.", "PROJECT_RISK_INCOMPLETE");
    if (to === "mitigating" && !mitigation) throw new ProjectError(409, "Describe the mitigation before marking it as mitigating.", "PROJECT_RISK_INCOMPLETE");
    set("status", to);
  }
  if (!sets.length) return r;
  const res = await qx(client, `UPDATE tenant.project_risks SET ${sets.join(",")},updated_at=now() WHERE id=$1 RETURNING *`, vals);
  return res.rows[0];
}

// A risk that has happened becomes an issue, linked both ways.
export async function realizeProjectRisk(client, c, riskId, input = {}) {
  need(c, "projects.view");
  const r = (await qx(client, `SELECT * FROM tenant.project_risks WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(riskId, "Risk")])).rows[0];
  if (!r) throw new ProjectError(404, "Risk was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, r.project_id, { lock: true });
  if (r.owner_user_id !== c.userId && !isPm(c, p)) throw new ProjectError(403, "Only the owner or a project manager can realise a risk.", "PROJECT_FORBIDDEN");
  if (["realized", "closed"].includes(r.status)) throw new ProjectError(409, `That risk is already ${r.status}.`, "PROJECT_STATE_INVALID");
  assertOpen(p, "raise the issue");
  const number = await nextNumber(client, c, "project_issue", "ISS");
  const issue = (await qx(client, `INSERT INTO tenant.project_issues(organization_id,company_id,project_id,issue_number,title,description,severity,owner_user_id,task_id,risk_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [c.organizationId, c.companyId, p.id, number, `Realised: ${r.title}`.slice(0, 300), textOrNull(input.description, 3000) || r.description, r.score >= 15 ? "high" : r.score >= 8 ? "medium" : "low", r.owner_user_id, r.task_id, r.id, c.userId])).rows[0];
  await client.query(`UPDATE tenant.project_risks SET status='realized',realized_issue_id=$2,updated_at=now() WHERE id=$1`, [r.id, issue.id]);
  await recordEvent(client, c, "risk", r.id, "project.risk.realized", { issue: issue.issue_number });
  return issue;
}

// ------------------------------------------------------------------ documents (F226)
export async function listProjectDocuments(client, c, filters = {}) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const where = [];
  const add = (sql, v) => { values.push(v); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (filters.projectId) add("d.project_id=?", uuid(filters.projectId, "Project"));
  if (filters.type) add("d.document_type=?", String(filters.type));
  if (!isBroad(c)) add("(p.project_manager_id=? OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=p.id AND m.user_id=? AND m.active=true))", c.userId);
  // confidential documents are for the manager, approvers and auditors only
  if (!(has(c, "projects.manage") || has(c, "projects.approve") || has(c, "projects.audit.view") || canSeeFinance(c))) { values.push(c.userId); where.push(`(d.confidential=false OR p.project_manager_id=$${values.length} OR d.created_by=$${values.length})`); }
  const res = await qx(client, `SELECT d.*,p.project_number,p.name AS project_name,u.full_name AS created_by_name FROM tenant.project_documents d JOIN tenant.projects p ON p.id=d.project_id LEFT JOIN public.users u ON u.id=d.created_by WHERE d.organization_id=$1 AND d.company_id=$2${where.map((w) => ` AND ${w}`).join("")} ORDER BY d.created_at DESC LIMIT 500`, values);
  return res.rows;
}

export async function addProjectDocument(client, c, projectId, input) {
  const p = await loadProject(client, c, projectId, { lock: true });
  await requireContributor(client, c, p);
  assertOpen(p, "add documents");
  const { taskId } = await checkLinks(client, p, input);
  const res = await qx(client, `INSERT INTO tenant.project_documents(organization_id,company_id,project_id,task_id,title,document_type,reference_url,version,confidential,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, p.id, taskId, requiredText(input.title, "Title", 300), oneOf(input.documentType || "other", ["contract", "scope", "plan", "deliverable", "report", "minutes", "change_request", "other"], "Document type"), textOrNull(input.referenceUrl, 1000), textOrNull(input.version, 20) || "1", input.confidential === true, c.userId]);
  await recordEvent(client, c, "document", res.rows[0].id, "project.document.added", { projectId: p.id });
  return res.rows[0];
}

export async function removeProjectDocument(client, c, documentId) {
  need(c, "projects.view");
  const d = (await qx(client, `SELECT * FROM tenant.project_documents WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(documentId, "Document")])).rows[0];
  if (!d) throw new ProjectError(404, "Document was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, d.project_id, { lock: true });
  if (!canSeeDocument(c, p, d)) throw new ProjectError(404, "Document was not found.", "PROJECT_NOT_FOUND");
  if (d.created_by !== c.userId && !isPm(c, p)) throw new ProjectError(403, "Only the author or a project manager can remove a document.", "PROJECT_FORBIDDEN");
  assertOpen(p, "remove documents");
  await client.query(`DELETE FROM tenant.project_documents WHERE id=$1`, [d.id]);
  await recordEvent(client, c, "project", p.id, "project.document.removed", { title: d.title });
  return { ok: true };
}

// ------------------------------------------------------------------ comments (F227)
const ENTITY_TABLE = { project: "projects", task: "project_tasks", milestone: "project_milestones", issue: "project_issues", risk: "project_risks", document: "project_documents" };

export async function listProjectComments(client, c, input) {
  need(c, "projects.view");
  const type = oneOf(input.entityType, Object.keys(ENTITY_TABLE), "Entity type");
  const id = uuid(input.entityId, "Entity");
  const row = (await client.query(`SELECT ${type === "project" ? "id AS project_id" : "project_id"} FROM tenant.${ENTITY_TABLE[type]} WHERE organization_id=$1 AND id=$2`, [c.organizationId, id])).rows[0];
  if (!row) throw new ProjectError(404, "That record was not found.", "PROJECT_NOT_FOUND");
  const proj = await loadProject(client, c, row.project_id);
  if (type === "document") { const d = (await qx(client, `SELECT * FROM tenant.project_documents WHERE id=$1`, [id])).rows[0]; if (!canSeeDocument(c, proj, d)) throw new ProjectError(404, "That record was not found.", "PROJECT_NOT_FOUND"); }
  const res = await qx(client, `SELECT cm.*,u.full_name AS author_name FROM tenant.project_comments cm LEFT JOIN public.users u ON u.id=cm.author_user_id WHERE cm.organization_id=$1 AND cm.entity_type=$2 AND cm.entity_id=$3 AND cm.deleted_at IS NULL ORDER BY cm.created_at`, [c.organizationId, type, id]);
  return res.rows;
}

export async function addProjectComment(client, c, input) {
  need(c, "projects.view");
  const type = oneOf(input.entityType, Object.keys(ENTITY_TABLE), "Entity type");
  const id = uuid(input.entityId, "Entity");
  const row = (await client.query(`SELECT ${type === "project" ? "id AS project_id" : "project_id"} FROM tenant.${ENTITY_TABLE[type]} WHERE organization_id=$1 AND id=$2`, [c.organizationId, id])).rows[0];
  if (!row) throw new ProjectError(404, "That record was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, row.project_id, { lock: true });
  await requireContributor(client, c, p);
  if (type === "document") { const d = (await qx(client, `SELECT * FROM tenant.project_documents WHERE id=$1`, [id])).rows[0]; if (!canSeeDocument(c, p, d)) throw new ProjectError(404, "That record was not found.", "PROJECT_NOT_FOUND"); }
  const mentions = [...new Set((input.mentions || []).map((m) => uuid(m, "Mention")))];
  for (const m of mentions) if (!(await isMember(client, c, p.id, m))) throw new ProjectError(409, "You can only mention people on the project team.", "PROJECT_MENTION_INVALID");
  const res = await qx(client, `INSERT INTO tenant.project_comments(organization_id,company_id,project_id,entity_type,entity_id,body,mentions,internal,author_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, p.id, type, id, requiredText(input.body, "Comment", 4000), mentions, input.internal !== false, c.userId]);
  await recordEvent(client, c, "comment", res.rows[0].id, "project.comment.added", { entity: type, mentions: mentions.length });
  return res.rows[0];
}

export async function deleteProjectComment(client, c, commentId) {
  need(c, "projects.view");
  const cm = (await qx(client, `SELECT * FROM tenant.project_comments WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND deleted_at IS NULL`, [c.organizationId, c.companyId, uuid(commentId, "Comment")])).rows[0];
  if (!cm) throw new ProjectError(404, "Comment was not found.", "PROJECT_NOT_FOUND");
  const p = await loadProject(client, c, cm.project_id);
  if (cm.author_user_id !== c.userId && !isPm(c, p)) throw new ProjectError(403, "Only the author or a project manager can remove a comment.", "PROJECT_FORBIDDEN");
  await client.query(`UPDATE tenant.project_comments SET deleted_at=now() WHERE id=$1`, [cm.id]);
  return { ok: true };
}

// The comments that mention the caller (the "inbox" behind a mention).
export async function listMyMentions(client, c) {
  need(c, "projects.view");
  const res = await qx(client, `SELECT cm.id,cm.entity_type,cm.entity_id,cm.body,cm.created_at,p.project_number,u.full_name AS author_name FROM tenant.project_comments cm JOIN tenant.projects p ON p.id=cm.project_id LEFT JOIN public.users u ON u.id=cm.author_user_id WHERE cm.organization_id=$1 AND cm.company_id=$2 AND $3::uuid = ANY(cm.mentions) AND cm.deleted_at IS NULL ORDER BY cm.created_at DESC LIMIT 100`, [c.organizationId, c.companyId, c.userId]);
  return res.rows;
}
