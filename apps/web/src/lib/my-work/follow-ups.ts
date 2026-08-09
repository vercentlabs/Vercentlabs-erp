// Follow-ups & Reminders aggregation (Prompt 8, Part 5). CRM leads have a
// dedicated next_follow_up_at column — a genuinely distinct "follow-up"
// concept from a generic task, kept separate from Tasks (which reads CRM
// activities + project tasks) so the same underlying rows are never
// double-counted across both workspaces.
import { listCrmRecords } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/lib/auth";
import { crmApiContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { classifyDueAt, type WorkItem } from "@/lib/my-work/types";

export async function listMyFollowUps(
  session: WorkspaceSessionContext,
  limit = 50,
): Promise<WorkItem[]> {
  try {
    const context = await crmApiContext(session);
    const { rows } = await tenantTransaction(session.organizationId, (client) =>
      listCrmRecords(client, context, "leads", { limit: 200 }),
    );
    const items = rows
      .filter(
        (row: Record<string, unknown>) =>
          row.ownerUserId === session.userId &&
          row.nextFollowUpAt &&
          row.status !== "converted" &&
          row.status !== "unqualified",
      )
      .map((row: Record<string, unknown>) => ({
        id: `crm-lead-follow-up:${row.id}`,
        kind: "follow_up" as const,
        moduleId: "crm" as const,
        source: "CRM lead",
        title: String(
          [row.firstName, row.lastName].filter(Boolean).join(" ") ||
            row.companyName ||
            "Untitled lead",
        ),
        subtitle: row.companyName ? String(row.companyName) : undefined,
        dueAt: new Date(row.nextFollowUpAt as string).toISOString(),
        urgency: classifyDueAt(row.nextFollowUpAt as string),
        status: row.status ? String(row.status) : undefined,
        href: `/crm/leads/${row.id}`,
      }));
    items.sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
    return items.slice(0, limit);
  } catch {
    return [];
  }
}
