// Tasks aggregation (Prompt 8, Part 4). No cross-module tasks table exists
// (confirmed by repo-wide audit) — this reads from the two real,
// assignee+due-date-bearing sources found: CRM activities
// (tenant.crm_activities) and Project tasks (tenant.project_tasks). Every
// adapter reuses the exact module-gated session helper and secured list
// function the module's own pages/routes already use — this file adds no
// new SQL and no new authorization path.
import { listCrmRecords, listProjectResource } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/lib/auth";
import { crmApiContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { assertModuleAccessible } from "@/lib/module-access";
import { classifyDueAt, type WorkItem } from "@/lib/my-work/types";
import { projectsContext } from "@/lib/projects";

const CRM_ENTITY_HREF: Record<string, string> = {
  lead: "/crm/leads/",
  opportunity: "/crm/opportunities/",
  contact: "/crm/contacts/",
};

function activityHref(entityType: string | null, entityId: string | null) {
  if (entityType && entityId && CRM_ENTITY_HREF[entityType]) {
    return `${CRM_ENTITY_HREF[entityType]}${entityId}`;
  }
  return "/crm/activities";
}

async function crmActivityTasks(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    // "My Tasks" means mine, full stop — never broadened by
    // crm.records.view_all (Prompt 14, Part 17), for the same reason as
    // listMyFollowUps() in follow-ups.ts.
    const context = { ...(await crmApiContext(session)), permissions: [], roleSlugs: [] };
    const { rows } = await tenantTransaction(session.organizationId, (client) =>
      listCrmRecords(client, context, "activities", { due: "all", limit: 100 }),
    );
    return rows
      .filter(
        (row: Record<string, unknown>) =>
          row.assignedTo === session.userId &&
          row.status !== "completed" &&
          row.status !== "cancelled",
      )
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `crm-activity:${row.id}`,
        kind: "task" as const,
        moduleId: "crm" as const,
        source: "CRM activity",
        title: String(row.subject || "Untitled activity"),
        subtitle: row.activityType ? String(row.activityType) : undefined,
        dueAt: row.dueAt ? new Date(row.dueAt as string).toISOString() : undefined,
        urgency: classifyDueAt(row.dueAt as string | null, session.timezone),
        priority: row.priority ? String(row.priority) : undefined,
        status: row.status ? String(row.status) : undefined,
        href: activityHref(
          row.entityType as string | null,
          row.entityId as string | null,
        ),
      }));
  } catch {
    return [];
  }
}

async function projectTasks(
  session: WorkspaceSessionContext,
  limit: number,
): Promise<WorkItem[]> {
  try {
    await assertModuleAccessible(session, "projects");
    const context = projectsContext(session);
    const rows = await tenantTransaction(session.organizationId, (client) =>
      listProjectResource(client, context, "tasks", { limit: 200 }),
    );
    return rows
      .filter(
        (row: Record<string, unknown>) =>
          row.assignee_user_id === session.userId &&
          row.status !== "done" &&
          row.status !== "cancelled",
      )
      .slice(0, limit)
      .map((row: Record<string, unknown>) => ({
        id: `project-task:${row.id}`,
        kind: "task" as const,
        moduleId: "projects" as const,
        source: "Project task",
        title: String(row.name || row.title || "Untitled task"),
        dueAt: row.planned_end_date
          ? new Date(row.planned_end_date as string).toISOString()
          : undefined,
        urgency: classifyDueAt(row.planned_end_date as string | null, session.timezone),
        priority: row.priority ? String(row.priority) : undefined,
        status: row.status ? String(row.status) : undefined,
        href: "/projects/tasks",
      }));
  } catch {
    return [];
  }
}

export async function listMyTasks(
  session: WorkspaceSessionContext,
  limit = 50,
): Promise<WorkItem[]> {
  const [crm, projects] = await Promise.allSettled([
    crmActivityTasks(session, limit),
    projectTasks(session, limit),
  ]);
  const items = [
    ...(crm.status === "fulfilled" ? crm.value : []),
    ...(projects.status === "fulfilled" ? projects.value : []),
  ];
  items.sort((a, b) => {
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    return a.dueAt.localeCompare(b.dueAt);
  });
  return items.slice(0, limit);
}
