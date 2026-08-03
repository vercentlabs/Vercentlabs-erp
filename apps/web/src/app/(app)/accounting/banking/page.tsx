import {
  getBankingGovernanceDashboard,
  listBankAccounts,
  listBankStatements,
} from "@vercentlabs/api";

import { accountingContext } from "@/lib/accounting";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
type BankingDashboard = {
  summary?: Record<string, unknown>;
  cashPositions?: Row[];
  exceptionCases?: Row[];
  closeReadiness?: Row[];
};

function metric(value: unknown) {
  return Number(value || 0).toLocaleString("en-IN");
}

export default async function BankingPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingView)) {
    return (
      <section className="panel">
        <h1>Accounting access required</h1>
      </section>
    );
  }

  const context = accountingContext(session);
  const data = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      accounts: await listBankAccounts(client, context),
      statements: await listBankStatements(client, context),
      governance: await getBankingGovernanceDashboard(client, context),
    }),
  )) as {
    accounts: Row[];
    statements: Row[];
    governance: BankingDashboard;
  };

  const summary = data.governance.summary || {};

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Cash, banking and close governance</p>
          <h1>Bank accounts and reconciliation control</h1>
          <p>
            Import statements, resolve owned exceptions, monitor cash position,
            and prevent period close while banking evidence remains incomplete.
          </p>
        </div>
      </section>

      <section className="accounting-stat-grid">
        <article>
          <span>Statements</span>
          <strong>{metric(summary.totalStatements)}</strong>
          <small>{metric(summary.closeEligible)} close eligible</small>
        </article>
        <article>
          <span>Open lines</span>
          <strong>{metric(summary.openLineCount)}</strong>
          <small>Unmatched, suggested or partial</small>
        </article>
        <article>
          <span>Attention</span>
          <strong>{metric(summary.attention)}</strong>
          <small>{metric(summary.blocked)} blocked</small>
        </article>
        <article>
          <span>High risk</span>
          <strong>{metric(summary.highRisk)}</strong>
          <small>Escalation or aged exceptions</small>
        </article>
      </section>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Bank accounts</p>
          <h2>Connected cash ledgers</h2>
          <div className="accounting-list">
            {data.accounts.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>
                    {String(row.bank_name)} · {String(row.account_name)}
                  </strong>
                  <small>
                    {String(row.code)} ·{" "}
                    {String(row.masked_account_number || "No account mask")}
                  </small>
                </span>
                <b>{String(row.currency_code)}</b>
              </div>
            ))}
            {!data.accounts.length ? (
              <p>No bank accounts are configured.</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Statements</p>
          <h2>Reconciliation queue</h2>
          <div className="accounting-list">
            {data.statements.map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.statement_number)}</strong>
                  <small>
                    {String(row.bank_name)} ·{" "}
                    {String(row.period_start).slice(0, 10)}
                    {" to "}
                    {String(row.period_end).slice(0, 10)}
                  </small>
                </span>
                <b>{String(row.status)}</b>
              </div>
            ))}
            {!data.statements.length ? (
              <p>No bank statements have been imported.</p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="accounting-two-column">
        <section className="panel">
          <p className="eyebrow">Exception ownership</p>
          <h2>Unresolved reconciliation cases</h2>
          <div className="accounting-list">
            {(data.governance.exceptionCases || []).slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.statement_number)}</strong>
                  <small>
                    {String(row.bank_name)} · {String(row.reason_code)}
                  </small>
                </span>
                <b>{String(row.priority)}</b>
              </div>
            ))}
            {!data.governance.exceptionCases?.length ? (
              <p>No unresolved reconciliation exception cases.</p>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <p className="eyebrow">Close readiness</p>
          <h2>Open periods with banking blockers</h2>
          <div className="accounting-list">
            {(data.governance.closeReadiness || []).slice(0, 8).map((row) => (
              <div key={String(row.id)}>
                <span>
                  <strong>{String(row.name)}</strong>
                  <small>
                    {String(row.start_date).slice(0, 10)} to{" "}
                    {String(row.end_date).slice(0, 10)}
                  </small>
                </span>
                <b>
                  {metric(
                    Number(row.open_reconciliations || 0) +
                      Number(row.unreconciled_lines || 0),
                  )}
                </b>
              </div>
            ))}
            {!data.governance.closeReadiness?.length ? (
              <p>No open fiscal periods require banking review.</p>
            ) : null}
          </div>
        </section>
      </div>

      <section className="panel">
        <p className="eyebrow">Controlled workflow</p>
        <h2>Reconciliation and close process</h2>
        <div className="accounting-process">
          <span>1. Configure governed bank GL account</span>
          <span>2. Import a hashed statement</span>
          <span>3. Review exact and rule suggestions</span>
          <span>4. Own and resolve every exception</span>
          <span>5. Complete balanced reconciliation</span>
          <span>6. Capture close-readiness evidence</span>
        </div>
      </section>
    </>
  );
}
