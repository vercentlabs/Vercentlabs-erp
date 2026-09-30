// The Projects home dashboard. A person holding only view/time rights sees only the projects they belong to.
import { has, isBroad, need, qx } from "./common.js";

function scope(c, values, alias = "p") {
  if (isBroad(c)) return "";
  values.push(c.userId);
  return ` AND (${alias}.project_manager_id=$${values.length} OR EXISTS (SELECT 1 FROM tenant.project_members m WHERE m.project_id=${alias}.id AND m.user_id=$${values.length} AND m.active=true))`;
}

export async function getProjectsDeskDashboard(client, c) {
  need(c, "projects.view");
  const values = [c.organizationId, c.companyId];
  const s = scope(c, values);
  const projects = await client.query(`SELECT p.status,p.health,count(*)::int AS n,count(*) FILTER (WHERE p.status IN ('planned','active') AND p.planned_end_date<current_date)::int AS overdue FROM tenant.projects p WHERE p.organization_id=$1 AND p.company_id=$2${s} GROUP BY p.status,p.health`, values);
  const byStatus = {}; const byHealth = {}; let overdueProjects = 0;
  for (const r of projects.rows) { byStatus[r.status] = (byStatus[r.status] || 0) + r.n; if (["planned", "active", "on_hold"].includes(r.status)) byHealth[r.health] = (byHealth[r.health] || 0) + r.n; overdueProjects += r.overdue; }
  const tv = [c.organizationId, c.companyId, c.userId];
  const mine = await client.query(`SELECT count(*) FILTER (WHERE t.status NOT IN ('done','cancelled'))::int AS open,count(*) FILTER (WHERE t.status NOT IN ('done','cancelled') AND t.planned_end_date<current_date)::int AS overdue FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id WHERE t.organization_id=$1 AND p.company_id=$2 AND t.assignee_user_id=$3`, tv);
  const v2 = [c.organizationId, c.companyId];
  const s2 = scope(c, v2);
  const work = await client.query(`SELECT count(*) FILTER (WHERE t.status NOT IN ('done','cancelled') AND t.planned_end_date<current_date)::int AS overdue_tasks,count(*) FILTER (WHERE t.status='blocked')::int AS blocked_tasks FROM tenant.project_tasks t JOIN tenant.projects p ON p.id=t.project_id WHERE t.organization_id=$1 AND p.company_id=$2${s2}`, v2);
  const w0 = work.rows[0];
  const out = { projectsByStatus: byStatus, activeByHealth: byHealth, overdueProjects, myOpenTasks: mine.rows[0].open, myOverdueTasks: mine.rows[0].overdue, overdueTasks: w0.overdue_tasks, blockedTasks: w0.blocked_tasks };
  if (has(c, "projects.time.approve") || isBroad(c)) {
    const a = await client.query(`SELECT (SELECT count(*) FROM tenant.project_timesheets WHERE organization_id=$1 AND company_id=$2 AND status='submitted')::int AS timesheets`, [c.organizationId, c.companyId]);
    out.pendingApprovals = a.rows[0];
  }
  const v4 = [c.organizationId, c.companyId];
  const s4 = scope(c, v4);
  const upcoming = await qx(client, `SELECT m.id,m.name,m.planned_date,p.project_number FROM tenant.project_milestones m JOIN tenant.projects p ON p.id=m.project_id WHERE m.organization_id=$1 AND p.company_id=$2 AND m.status IN ('planned','in_progress') AND m.planned_date BETWEEN current_date AND current_date+14${s4} ORDER BY m.planned_date LIMIT 10`, v4);
  out.upcomingMilestones = upcoming.rows;
  return out;
}
