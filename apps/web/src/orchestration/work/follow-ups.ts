// Follow-ups & Reminders aggregation (Prompt 8, Part 5; rewired 2026-09-05
// per owner decision on the F016 atomic-requirement trace). The lead
// nurture queue (crm_lead_nurture_queue, services/api/src/modules/crm/
// lead-intelligence.js) already implements what F016's dossier actually
// asks for — priority-scored recommendations with due dates, snooze,
// claim and complete semantics, dedup via a partial unique index — so it
// IS this feature now, not a separate AI system running in parallel to a
// thinner next_follow_up_at-based list.
import { listMyNurtureQueueItems } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/auth";
import { crmApiContext } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { classifyDueAt, type WorkItem } from "@/shared/work/types";

function actionLabel(action: unknown) {
  const value = String(action || "").trim();
  if (!value) return "Follow up";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export async function listMyFollowUps(
  session: WorkspaceSessionContext,
  limit = 50,
): Promise<WorkItem[]> {
  try {
    const context = await crmApiContext(session);
    const rows = await tenantTransaction(session.organizationId, (client) =>
      listMyNurtureQueueItems(client, context, limit),
    );
    const items = (rows as Array<Record<string, unknown>>).map((row) => ({
      id: `crm-lead-nurture:${row.id}`,
      kind: "follow_up" as const,
      moduleId: "crm" as const,
      source: "CRM lead",
      title: String(
        [row.first_name, row.last_name].filter(Boolean).join(" ") ||
          row.full_name ||
          row.company_name ||
          "Untitled lead",
      ),
      subtitle: [
        row.company_name ? String(row.company_name) : null,
        actionLabel(row.recommended_action),
      ]
        .filter(Boolean)
        .join(" · "),
      dueAt: row.due_at ? new Date(row.due_at as string).toISOString() : undefined,
      urgency: classifyDueAt(row.due_at as string | null, session.timezone),
      status: row.status ? String(row.status) : undefined,
      priority:
        Number(row.priority_score) >= 70
          ? "high"
          : Number(row.priority_score) >= 40
            ? "medium"
            : "low",
      href: `/crm/leads/${row.lead_id}`,
    }));
    items.sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
    return items.slice(0, limit);
  } catch {
    return [];
  }
}
