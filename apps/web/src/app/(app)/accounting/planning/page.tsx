import { getAccountingOptions, listAccrualSchedules, listBudgets, listCashForecasts, listRecurringTemplates } from "@vercentlabs/api";
import AccountingActionButton from "@/modules/accounting/components/accounting-action-button";
import BudgetEditor from "@/modules/accounting/components/budget-editor";
import RecurringEditor from "@/modules/accounting/components/recurring-editor";
import SimpleAccountingForm from "@/modules/accounting/components/simple-accounting-form";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { accountingContext } from "@/modules/accounting";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;
type Option = { id: string; code?: string; name?: string; journal_type?: string; is_group?: boolean };

export default async function AccountingPlanningPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) return <section className="panel"><h1>Accounting access required</h1></section>;
  if (!session.activeCompanyId) return <section className="panel"><h1>Select a company first</h1></section>;
  const context = accountingContext(session);
  const data = await tenantTransaction(context.organizationId, async (client) => ({
    options: await getAccountingOptions(client, context, session.activeCompanyId),
    budgets: await listBudgets(client, context),
    recurring: await listRecurringTemplates(client, context),
    accruals: await listAccrualSchedules(client, context),
    forecasts: await listCashForecasts(client, context),
  })) as unknown as { options: { company: Row; accounts: Option[]; journals: Option[] }; budgets: Row[]; recurring: Row[]; accruals: Row[]; forecasts: Row[] };
  const companyId = String(data.options.company.id);
  const baseCurrency = String(data.options.company.base_currency);
  const accountOptions = data.options.accounts.filter((account) => !account.is_group).map((account) => ({ value: account.id, label: `${account.code} · ${account.name}` }));
  return <>
    <section className="page-heading"><div><p className="eyebrow">Plan and automate</p><h1>Budgets, recurring journals and accruals</h1><p>Control planned spend, automate repeat entries, and recognize expenses or revenue in the correct accounting periods.</p></div></section>
    <section className="accounting-kpi-grid"><article className="metric-card"><span>Budget versions</span><strong>{data.budgets.length}</strong></article><article className="metric-card"><span>Recurring templates</span><strong>{data.recurring.length}</strong></article><article className="metric-card"><span>Accrual schedules</span><strong>{data.accruals.length}</strong></article><article className="metric-card"><span>Cash forecasts</span><strong>{data.forecasts.length}</strong></article></section>
    <div className="accounting-three-column"><section className="panel"><p className="eyebrow">Budgets</p><h2>Versions and scenarios</h2><div className="accounting-list">{data.budgets.map((row) => <div key={String(row.id)}><span><strong>{String(row.code)} · {String(row.name)}</strong><small>{String(row.fiscal_year)} · {String(row.scenario)} · version {String(row.version_number)}</small></span><b>{String(row.currency_code)} {String(row.total_amount)}</b></div>)}{!data.budgets.length ? <p>No budgets exist.</p> : null}</div></section><section className="panel"><p className="eyebrow">Recurring journals</p><h2>Scheduled postings</h2><div className="accounting-list">{data.recurring.map((row) => <div key={String(row.id)}><span><strong>{String(row.code)} · {String(row.name)}</strong><small>{String(row.frequency)} · next {String(row.next_run_date).slice(0, 10)}</small></span><b>{String(row.status)}</b></div>)}{!data.recurring.length ? <p>No recurring templates exist.</p> : null}</div></section><section className="panel"><p className="eyebrow">Accruals and deferrals</p><h2>Recognition schedules</h2><div className="accounting-list">{data.accruals.map((row) => <div key={String(row.id)}><span><strong>{String(row.code)} · {String(row.name)}</strong><small>{String(row.schedule_type).replaceAll("_", " ")} · {String(row.posted_count)}/{String(row.recognition_count)} posted</small></span><b>{baseCurrency} {String(row.recognized_amount)} / {String(row.total_amount)}</b></div>)}{!data.accruals.length ? <p>No accrual schedules exist.</p> : null}</div></section></div>
    <section className="panel"><p className="eyebrow">Treasury planning</p><h2>Cash-flow forecast scenarios</h2><div className="accounting-list">{data.forecasts.map((row) => <div key={String(row.id)}><span><strong>{String(row.code)} · {String(row.name)}</strong><small>{String(row.start_date).slice(0, 10)} to {String(row.end_date).slice(0, 10)} · {String(row.line_count || 0)} forecast lines</small></span><span><b>{String(row.status)}</b>{hasPermission(session, PERMISSIONS.accountingBudgetManage) && ["draft", "generated"].includes(String(row.status)) ? <AccountingActionButton endpoint={`/api/accounting/forecasts/${String(row.id)}/generate`} action="generate" label="Generate" /> : null}</span></div>)}{!data.forecasts.length ? <p>No cash-flow forecast scenario exists.</p> : null}</div></section>
    {hasPermission(session, PERMISSIONS.accountingBudgetManage) ? <SimpleAccountingForm title="Cash-flow forecast" description="Combine open receivable and payable schedules with recurring and manual forecast lines." endpoint="/api/accounting/forecasts" submitLabel="Create forecast scenario" basePayload={{ companyId }} fields={[{ name: "code", label: "Scenario code", required: true }, { name: "name", label: "Scenario name", required: true }, { name: "startDate", label: "Start date", type: "date", required: true }, { name: "endDate", label: "End date", type: "date", required: true }, { name: "currencyCode", label: "Currency", defaultValue: baseCurrency, required: true }, { name: "includeOpenReceivables", label: "Include receivables", type: "checkbox", defaultValue: true }, { name: "includeOpenPayables", label: "Include payables", type: "checkbox", defaultValue: true }, { name: "includeRecurring", label: "Include recurring journals", type: "checkbox", defaultValue: true }]} /> : null}
    {hasPermission(session, PERMISSIONS.accountingBudgetManage) ? <BudgetEditor companyId={companyId} baseCurrency={baseCurrency} accounts={data.options.accounts} /> : null}
    {hasPermission(session, PERMISSIONS.accountingRecurringManage) ? <><RecurringEditor companyId={companyId} baseCurrency={baseCurrency} journals={data.options.journals} accounts={data.options.accounts} /><SimpleAccountingForm title="Accrual or deferral schedule" description="Generate deterministic recognition dates and balanced journals." endpoint="/api/accounting/accruals" submitLabel="Create schedule" basePayload={{ companyId }} fields={[
      { name: "code", label: "Code", required: true }, { name: "name", label: "Name", required: true }, { name: "scheduleType", label: "Type", type: "select", required: true, options: [{ value: "accrual", label: "Accrual" }, { value: "deferred_expense", label: "Deferred expense" }, { value: "deferred_revenue", label: "Deferred revenue" }] }, { name: "startDate", label: "Start date", type: "date", required: true }, { name: "endDate", label: "End date", type: "date", required: true }, { name: "totalAmount", label: "Total amount", type: "number", required: true }, { name: "sourceAccountId", label: "Source account", type: "select", required: true, options: accountOptions }, { name: "targetAccountId", label: "Target account", type: "select", required: true, options: accountOptions }, { name: "frequency", label: "Frequency", type: "select", defaultValue: "monthly", options: [{ value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "yearly", label: "Yearly" }] },
    ]} /></> : null}
  </>;
}
