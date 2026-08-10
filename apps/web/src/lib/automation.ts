// Prompt 10 (Administration Foundation) — Automation workspace data
// access, extended by Prompt 13 (Worker & Scheduler Foundation). There is
// no cross-module workflow/rule engine anywhere in the repository
// (workflow_definitions, a control-plane table, is confirmed dead schema —
// never read or written by any application code). The one real, working
// rule -> action automation engine is CRM-scoped:
// tenant.crm_automation_rules (a registered CRM resource, read via the
// existing listCrmRecords()) and tenant.crm_automation_runs (a genuine
// execution log — written on every rule run). Rule management continues
// to happen entirely through the existing CRM Settings > Automation rules
// tab, gated by the existing crm.automation.manage permission, unchanged.
//
// Prompt 13 made "activity.overdue" a genuinely live trigger: a real
// worker process (services/worker) now runs a periodic scheduled tick
// (crm.automation.detect_overdue_activities, tenant.background_jobs) that
// transitions overdue activities and fires the existing automation engine
// for them — see docs/implementation/ERP_WORKER_SCHEDULER_013.md Section
// 16. "lead.updated", "lead.qualified" and "campaign.member_responded"
// remain unsupported for an unrelated reason: they are missing
// synchronous call sites in CRM mutation code (not a scheduling gap the
// worker could ever fix) — a distinct, still-open gap tracked for a
// future CRM-completion prompt, not invented or silently hidden here.
import { listCrmRecords } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/lib/auth";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

// The full set of event_type values the schema's CHECK constraint allows
// (and the rule-editor dropdown offers) vs. the ones any real call site in
// the app actually fires. Keeping both lists here, explicitly, is what
// lets the workspace be honest about which triggers are live (Part 21 —
// "only surface actual supported trigger/action types").
export const AUTOMATION_EVENT_TYPES = [
  "lead.created",
  "lead.updated",
  "lead.qualified",
  "opportunity.created",
  "opportunity.stage_changed",
  "activity.overdue",
  "campaign.member_responded",
] as const;

export const LIVE_AUTOMATION_EVENT_TYPES = new Set([
  "lead.created",
  "opportunity.created",
  "opportunity.stage_changed",
  "activity.overdue",
]);

export type BackgroundJobStatus = { status: string; count: number };

// Real queue-depth data from the new tenant.background_jobs table
// (052_background_jobs.sql) — pending/processing/completed/dead counts
// for this organization's scheduled automation work. Never a fabricated
// "worker healthy" indicator: an empty/all-zero result here honestly
// means either nothing has run yet or the worker process is not
// currently running, and the page must not claim otherwise.
export async function getScheduledAutomationStatus(
  session: WorkspaceSessionContext,
): Promise<{ jobStatus: BackgroundJobStatus[]; lastCompletedAt: Date | null }> {
  try {
    return await tenantTransaction(session.organizationId, async (client) => {
      const status = await client.query(
        `SELECT status, count(*)::int AS count
           FROM tenant.background_jobs
          WHERE organization_id = $1 AND job_type = 'crm.automation.detect_overdue_activities'
          GROUP BY status`,
        [session.organizationId],
      );
      const last = await client.query(
        `SELECT completed_at
           FROM tenant.background_jobs
          WHERE organization_id = $1 AND job_type = 'crm.automation.detect_overdue_activities' AND status = 'completed'
          ORDER BY completed_at DESC NULLS LAST
          LIMIT 1`,
        [session.organizationId],
      );
      return { jobStatus: status.rows, lastCompletedAt: last.rows[0]?.completed_at ?? null };
    });
  } catch {
    return { jobStatus: [], lastCompletedAt: null };
  }
}

export type AutomationRuleRow = {
  id: string;
  name: string;
  eventType: string;
  sequence: number;
  status: string;
};

export type AutomationRunRow = {
  id: string;
  rule_id: string | null;
  rule_name: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string;
  status: "succeeded" | "failed" | "skipped";
  result: unknown;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
};

export async function listAutomationRules(
  session: WorkspaceSessionContext,
): Promise<AutomationRuleRow[]> {
  try {
    const context = crmContext(session);
    const { rows } = await tenantTransaction(session.organizationId, (client) =>
      listCrmRecords(client, context, "automation-rules", { status: "all", limit: 100 }),
    );
    return rows as AutomationRuleRow[];
  } catch {
    return [];
  }
}

export async function listAutomationRuns(
  session: WorkspaceSessionContext,
  options: { page?: number; pageSize?: number } = {},
): Promise<{ rows: AutomationRunRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(Math.max(Number(options.pageSize) || 50, 1), 200);
  const page = Math.max(Number(options.page) || 1, 1);
  const offset = (page - 1) * pageSize;

  try {
    return await tenantTransaction(session.organizationId, async (client) => {
      const [{ count }] = (
        await client.query(
          `SELECT count(*)::int AS count FROM tenant.crm_automation_runs WHERE organization_id=$1`,
          [session.organizationId],
        )
      ).rows;
      const { rows } = await client.query(
        `SELECT run.id, run.rule_id, rule.name AS rule_name, run.event_type,
                run.entity_type, run.entity_id, run.status, run.result,
                run.error_message, run.started_at, run.finished_at
           FROM tenant.crm_automation_runs run
           LEFT JOIN tenant.crm_automation_rules rule ON rule.id = run.rule_id
          WHERE run.organization_id = $1
          ORDER BY run.started_at DESC
          LIMIT $2 OFFSET $3`,
        [session.organizationId, pageSize, offset],
      );
      return { rows, total: count || 0, page, pageSize };
    });
  } catch {
    return { rows: [], total: 0, page: 1, pageSize };
  }
}
