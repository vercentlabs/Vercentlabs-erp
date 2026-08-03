import { getTaxReportingGovernanceDashboard } from "@vercentlabs/api";

import SimpleAccountingForm from "@/components/accounting/simple-accounting-form";
import { accountingContext } from "@/lib/accounting";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type GovernedReturn = Row & {
  health?: {
    readiness?: string;
    riskBand?: string;
    warnings?: string[];
    blockers?: string[];
  };
};
type GovernanceDashboard = {
  summary?: Record<string, unknown>;
  returns?: GovernedReturn[];
  exceptionCases?: Row[];
  complianceRequests?: Row[];
  reportingSnapshots?: Row[];
};

function metric(value: unknown) {
  return Number(value || 0).toLocaleString("en-IN");
}

export default async function AccountingTaxPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) {
    return (
      <section className="panel">
        <h1>Accounting access required</h1>
      </section>
    );
  }
  if (!session.activeCompanyId) {
    return (
      <section className="panel">
        <h1>Select a company first</h1>
      </section>
    );
  }

  const context = accountingContext(session);
  const data = (await tenantTransaction(context.organizationId, (client) =>
    getTaxReportingGovernanceDashboard(client, context),
  )) as GovernanceDashboard;
  const summary = data.summary || {};
  const rows = data.returns || [];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Tax and statutory governance</p>
          <h1>Returns, exceptions and filing evidence</h1>
          <p>
            Reconcile component-level tax ledger entries, own filing exceptions,
            control statutory requests and preserve immutable reporting
            evidence.
          </p>
        </div>
      </section>

      <section className="accounting-stat-grid">
        <article>
          <span>Tax returns</span>
          <strong>{metric(summary.totalReturns)}</strong>
          <small>{metric(summary.ready)} ready</small>
        </article>
        <article>
          <span>Attention</span>
          <strong>{metric(summary.attention)}</strong>
          <small>{metric(summary.blocked)} blocked</small>
        </article>
        <article>
          <span>Overdue</span>
          <strong>{metric(summary.overdue)}</strong>
          <small>{metric(summary.highRisk)} high risk</small>
        </article>
        <article>
          <span>Open exceptions</span>
          <strong>{metric(summary.openExceptions)}</strong>
          <small>{metric(summary.failedCompliance)} failed requests</small>
        </article>
      </section>

      <section className="panel">
        <div className="accounting-section-heading">
          <div>
            <p className="eyebrow">Filing queue</p>
            <h2>Return readiness</h2>
          </div>
          <span>{rows.length} returns</span>
        </div>
        <div className="accounting-table">
          <div className="accounting-table-row accounting-table-head">
            <span>Return</span>
            <span>Period</span>
            <span>Status</span>
            <span>Readiness</span>
            <span>Net payable</span>
            <span>Evidence</span>
          </div>
          {rows.map((row) => (
            <div className="accounting-table-row" key={String(row.id)}>
              <span>
                <strong>{String(row.return_type)}</strong>
                <small>
                  {String(row.tax_registration || "Registration pending")}
                </small>
              </span>
              <span>
                {String(row.period_start).slice(0, 10)} to{" "}
                {String(row.period_end).slice(0, 10)}
              </span>
              <span>{String(row.status)}</span>
              <span>
                <strong>{String(row.health?.readiness || "unknown")}</strong>
                <small>{String(row.health?.riskBand || "low")} risk</small>
              </span>
              <span>{String(row.net_tax_payable)}</span>
              <span>
                {metric(row.line_count)} lines ·{" "}
                {metric(row.open_exception_count)} exceptions
              </span>
            </div>
          ))}
          {!rows.length ? <p>No tax returns have been generated.</p> : null}
        </div>
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Exception ownership</p>
          <h2>Unresolved statutory cases</h2>
          <div className="accounting-list">
            {(data.exceptionCases || []).slice(0, 10).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.return_type)} · {String(row.reason_code)}
                  </strong>
                  <small>
                    {String(row.company_name)} ·{" "}
                    {String(row.period_end).slice(0, 10)}
                  </small>
                </span>
                <b>{String(row.priority)}</b>
              </div>
            ))}
            {!data.exceptionCases?.length ? (
              <p>No unresolved tax exception cases.</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Statutory outbox</p>
          <h2>Pending and failed requests</h2>
          <div className="accounting-list">
            {(data.complianceRequests || []).slice(0, 10).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.request_number)} ·{" "}
                    {String(row.compliance_type).replaceAll("_", " ")}
                  </strong>
                  <small>{String(row.company_name)}</small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))}
            {!data.complianceRequests?.length ? (
              <p>No pending or failed statutory requests.</p>
            ) : null}
          </div>
        </section>
      </div>

      {hasPermission(session, PERMISSIONS.accountingTaxManage) ? (
        <SimpleAccountingForm
          title="Generate tax return"
          description="Aggregate source tax-ledger entries into a governed filing period."
          endpoint="/api/accounting/tax/returns"
          submitLabel="Generate return"
          basePayload={{ companyId: session.activeCompanyId }}
          fields={[
            {
              name: "returnType",
              label: "Return type",
              required: true,
              defaultValue: "GST",
            },
            { name: "taxRegistration", label: "Tax registration" },
            {
              name: "periodStart",
              label: "Period start",
              type: "date",
              required: true,
            },
            {
              name: "periodEnd",
              label: "Period end",
              type: "date",
              required: true,
            },
            {
              name: "filingDueDate",
              label: "Filing due date",
              type: "date",
            },
          ]}
        />
      ) : null}

      {hasPermission(session, PERMISSIONS.accountingTaxManage) ? (
        <SimpleAccountingForm
          title="Queue statutory compliance"
          description="Create an idempotent request for an e-invoice, e-way bill, TDS statement, tax payment or statutory report."
          endpoint="/api/accounting/compliance/requests"
          submitLabel="Queue compliance request"
          basePayload={{ companyId: session.activeCompanyId }}
          fields={[
            {
              name: "complianceType",
              label: "Compliance type",
              type: "select",
              required: true,
              options: [
                { value: "gst_einvoice", label: "GST e-invoice" },
                { value: "gst_eway_bill", label: "GST e-way bill" },
                { value: "tds_statement", label: "TDS statement" },
                { value: "tax_payment", label: "Tax payment" },
                { value: "statutory_report", label: "Statutory report" },
                { value: "other", label: "Other" },
              ],
            },
            {
              name: "sourceType",
              label: "Source type",
              type: "select",
              required: true,
              options: [
                { value: "customer_invoice", label: "Customer invoice" },
                { value: "vendor_bill", label: "Vendor bill" },
                { value: "tax_return", label: "Tax return" },
                { value: "journal_entry", label: "Journal entry" },
              ],
            },
            {
              name: "sourceId",
              label: "Source record ID",
              required: true,
            },
            { name: "idempotencyKey", label: "Idempotency key" },
          ]}
        />
      ) : null}

      <section className="panel">
        <p className="eyebrow">Controlled workflow</p>
        <h2>Tax and reporting evidence process</h2>
        <div className="accounting-process">
          <span>1. Post traceable source tax components</span>
          <span>2. Generate the return period</span>
          <span>3. Reconcile return totals to ledger lines</span>
          <span>4. Own and resolve filing exceptions</span>
          <span>5. Capture external filing references</span>
          <span>6. Preserve reporting snapshots and hashes</span>
        </div>
      </section>
    </>
  );
}
