import { notFound } from "next/navigation";
import { getCloseRun } from "@vercentlabs/api";
import AccountingActionButton from "@/components/accounting/accounting-action-button";
import CloseTaskActions from "@/components/accounting/close-task-actions";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { accountingContext } from "@/lib/accounting";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
type Detail = { run: Row; tasks: Row[]; blockers: Row[] };

export default async function CloseRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) return notFound();
  const context = accountingContext(session);
  let detail: Detail;
  try { detail = await tenantTransaction(context.organizationId, (client) => getCloseRun(client, context, id)) as unknown as Detail; }
  catch { return notFound(); }
  const canManage = hasPermission(session, PERMISSIONS.accountingCloseManage);
  return <>
    <section className="page-heading"><div><p className="eyebrow">Period close · {String(detail.run.close_type)}</p><h1>{String(detail.run.run_number)}</h1><p>{String(detail.run.company_name)} · {String(detail.run.period_name)}</p></div><span className="status-badge neutral">{String(detail.run.status)}</span></section>
    <div className="accounting-action-bar">{canManage && !["completed", "cancelled"].includes(String(detail.run.status)) ? <AccountingActionButton endpoint={`/api/accounting/close/${id}/actions`} action="complete" body={{ expectedVersion: Number(detail.run.version) }} label={String(detail.run.close_type) === "year" ? "Post year-end close and lock" : "Complete close"} tone="primary" /> : null}</div>
    <section className="panel"><div className="accounting-section-heading"><div><p className="eyebrow">System controls</p><h2>Close blockers</h2></div><span>{detail.blockers.length} categories</span></div><div className="accounting-list">{detail.blockers.map((row) => <div key={String(row.key)}><span><strong>{String(row.key).replaceAll("_", " ")}</strong><small>{String(row.message)}</small></span><b>{String(row.count)}</b></div>)}{!detail.blockers.length ? <p>No system-generated close blockers remain.</p> : null}</div></section>
    <section className="panel"><p className="eyebrow">Evidence checklist</p><h2>Close tasks</h2><div className="accounting-list">{detail.tasks.map((row) => <div key={String(row.id)}><span><strong>{String(row.sequence)} · {String(row.name)}</strong><small>{String(row.note || "Evidence or reviewer note has not been recorded.")}</small></span><span><b>{String(row.status)}</b>{canManage ? <CloseTaskActions endpoint={`/api/accounting/close/${id}/tasks/${String(row.id)}`} status={String(row.status)} version={Number(row.version)} /> : null}</span></div>)}</div></section>
  </>;
}
