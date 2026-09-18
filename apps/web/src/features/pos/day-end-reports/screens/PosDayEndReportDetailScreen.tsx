"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, Select, StatusBadge, TextArea } from "@vercentlabs/design-system";
import { POS_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { PosApiError } from "@/features/pos/shared/http";
import {
  finalizePosDayEndReport,
  getPosDayEndReport,
  recordPosDayEndVariance,
  reviewPosDayEndReport,
} from "@/features/pos/day-end-reports/api/day-end-reports-api";
import { generatePosReconciliation, type PosReconciliation } from "@/features/pos/reconciliation/api/reconciliation-api";
import { postPosDayEndReportToAccounting } from "@/features/pos/accounting/api/accounting-api";
import { calendarDate, money } from "@/features/pos/shared/format";

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "warning",
  reviewed: "info",
  closed: "success",
  void: "neutral",
};

type Tender = { method: string; amount: string; count: number };
type Lineage = { shiftIds: string[]; saleIds: string[]; returnIds: string[]; cashMovementIds: string[] };
type Correction = { id: string; correction_number: string; variance_type: string; reason: string; created_at: string };

export function PosDayEndReportDetailScreen({ reportId }: { reportId: string }) {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canReview = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reportGenerate);
  const canFinalize = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reportFinalize);
  const canReconcile = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.reconciliationManage);
  const canPostAccounting = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(POS_PERMISSIONS.accountingPost);

  const [actionError, setActionError] = useState<string | null>(null);
  const [showVariance, setShowVariance] = useState(false);
  const [varianceType, setVarianceType] = useState("cash_variance");
  const [varianceReason, setVarianceReason] = useState("");
  const [reconciliationRows, setReconciliationRows] = useState<PosReconciliation[] | null>(null);
  const [postingSummary, setPostingSummary] = useState<{ posted: number; alreadyPosted: number; failed: number } | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "day-end-report", reportId),
    queryFn: () => getPosDayEndReport(reportId),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "day-end-report", reportId) });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "day-end-reports") });
  }

  function handleError(error: unknown) {
    setActionError(error instanceof PosApiError ? error.message : "This action could not be completed.");
  }

  const reviewMutation = useMutation({
    mutationFn: () => reviewPosDayEndReport(reportId),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: handleError,
  });
  const finalizeMutation = useMutation({
    mutationFn: () => finalizePosDayEndReport(reportId),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: handleError,
  });
  const varianceMutation = useMutation({
    mutationFn: () => recordPosDayEndVariance(reportId, { varianceType, reason: varianceReason }),
    onSuccess: () => {
      setActionError(null);
      setShowVariance(false);
      setVarianceReason("");
      invalidate();
    },
    onError: handleError,
  });
  const reconcileMutation = useMutation({
    mutationFn: () => generatePosReconciliation(reportId),
    onSuccess: (result) => {
      setActionError(null);
      setReconciliationRows(result.reconciliations);
      invalidate();
    },
    onError: handleError,
  });
  const postAccountingMutation = useMutation({
    mutationFn: () => postPosDayEndReportToAccounting(reportId),
    onSuccess: (result) => {
      setActionError(null);
      setPostingSummary({ posted: result.posted.length, alreadyPosted: result.alreadyPosted.length, failed: result.failed.length });
      invalidate();
    },
    onError: handleError,
  });

  if (query.isLoading) return <p className="p-6 text-sm text-text-secondary">Loading day-end report…</p>;
  if (query.isError || !query.data) {
    return <ErrorState title="Could not load this day-end report" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const report = query.data.report as typeof query.data.report & {
    tender_totals: Tender[];
    lineage: Lineage;
    corrections: Correction[];
  };

  return (
    <div className="flex flex-col gap-6 p-6 print:p-0">
      <div className="flex items-start justify-between gap-4 print:hidden">
        <div>
          <button type="button" className="text-sm text-text-secondary hover:underline" onClick={() => router.push("/pos/reports/day-end")}>
            ← All day-end reports
          </button>
          <h1 className="mt-1 text-2xl font-semibold text-text">Z Report {report.report_number}</h1>
          <p className="text-sm text-text-secondary">
            {report.scope_type === "shift" ? "Per-shift report" : "Business-day report"} · Business date {calendarDate(report.business_date)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={statusTone[report.status] ?? "neutral"}>{report.status}</StatusBadge>
          <Button variant="secondary" onPress={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {actionError && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger print:hidden">
          {actionError}
        </p>
      )}

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">Z Report {report.report_number}</h1>
        <p className="text-sm">Business date {calendarDate(report.business_date)} · Status {report.status}</p>
      </div>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Sales reconciliation</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ["Sales count", String(report.sale_count)],
            ["Gross sales", money("", report.gross_sales_total)],
            ["Discounts", money("", report.discount_total)],
            ["Tax", money("", report.tax_total)],
            ["Net sales", money("", report.net_sales_total)],
            ["Rounding", money("", report.rounding_total)],
            ["Grand total", money("", report.grand_sales_total)],
            ["Returns count", String(report.return_count)],
            ["Returns/refunds", money("", report.return_total)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="text-lg font-semibold text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Tender breakdown</h2>
        {report.tender_totals.length === 0 ? (
          <p className="text-sm text-text-secondary">No payments in scope.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2">Method</th>
                <th className="pb-2">Count</th>
                <th className="pb-2">Amount</th>
              </tr>
            </thead>
            <tbody>
              {report.tender_totals.map((tender) => (
                <tr key={tender.method} className="border-t border-border">
                  <td className="py-2 capitalize">{tender.method}</td>
                  <td className="py-2">{tender.count}</td>
                  <td className="py-2">{money("", tender.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5">
        <h2 className="mb-3 text-base font-semibold text-text">Cash reconciliation</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ["Opening cash", money("", report.opening_cash_total)],
            ["Paid in", money("", report.paid_in_total)],
            ["Paid out", money("", report.paid_out_total)],
            ["Expected cash", money("", report.expected_cash_total)],
            ["Counted cash", report.counted_cash_total != null ? money("", report.counted_cash_total) : "—"],
            ["Variance", money("", report.cash_variance_total)],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-text-muted">{label}</dt>
              <dd className="text-lg font-semibold text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5 print:hidden">
        <h2 className="mb-3 text-base font-semibold text-text">Lineage</h2>
        <p className="text-sm text-text-secondary">
          {report.lineage.shiftIds.length} shift(s), {report.lineage.saleIds.length} sale(s), {report.lineage.returnIds.length} return(s),{" "}
          {report.lineage.cashMovementIds.length} cash movement(s) contributed to this report.
        </p>
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5 print:hidden">
        <h2 className="mb-3 text-base font-semibold text-text">Payment reconciliation (F304)</h2>
        <p className="mb-3 text-sm text-text-secondary">
          Status: <span className="font-medium text-text">{report.reconciliation_status}</span> · {report.reconciliation_references.length} reference(s),{" "}
          {report.outstanding_exceptions.length} outstanding exception(s).
        </p>
        {report.status === "closed" && canReconcile && (
          <Button variant="secondary" size="compact" onPress={() => reconcileMutation.mutate()} isLoading={reconcileMutation.isPending}>
            Generate reconciliation
          </Button>
        )}
        {reconciliationRows && (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="pb-2">Method</th>
                <th className="pb-2">Expected</th>
                <th className="pb-2">Settled</th>
                <th className="pb-2">Variance</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {reconciliationRows.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2 capitalize">{row.payment_method}</td>
                  <td className="py-2">{money("", row.expected_amount)}</td>
                  <td className="py-2">{money("", row.settled_amount)}</td>
                  <td className="py-2">{money("", row.variance_amount)}</td>
                  <td className="py-2">
                    <StatusBadge tone={row.status === "matched" || row.status === "resolved" ? "success" : "warning"}>{row.status}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {reconciliationRows && reconciliationRows.some((row) => row.status === "variance") && (
          <p className="mt-2 text-xs text-text-muted">
            Exceptions with a variance need investigation — see the <a href="/pos/reconciliation" className="underline">Reconciliation</a> screen to resolve them.
          </p>
        )}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5 print:hidden">
        <h2 className="mb-3 text-base font-semibold text-text">Accounting posting (F305)</h2>
        <p className="mb-3 text-sm text-text-secondary">
          Posts this report&apos;s sales and returns to the general ledger through Accounting&apos;s own journal contract.
        </p>
        {report.status === "closed" && canPostAccounting && (
          <Button variant="secondary" size="compact" onPress={() => postAccountingMutation.mutate()} isLoading={postAccountingMutation.isPending}>
            Post to accounting
          </Button>
        )}
        {postingSummary && (
          <p className="mt-2 text-sm text-text-secondary">
            {postingSummary.posted} posted, {postingSummary.alreadyPosted} already posted, {postingSummary.failed} failed.
            {postingSummary.failed > 0 && (
              <>
                {" "}
                See the <a href="/pos/accounting" className="underline">Accounting posting</a> screen for failure details and retry.
              </>
            )}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border-strong bg-surface p-5 print:hidden">
        <h2 className="text-base font-semibold text-text">Workflow</h2>
        <div className="flex flex-wrap gap-2">
          {report.status === "draft" && canReview && (
            <Button variant="primary" onPress={() => reviewMutation.mutate()} isLoading={reviewMutation.isPending}>
              Mark reviewed
            </Button>
          )}
          {report.status === "reviewed" && canFinalize && (
            <Button variant="primary" onPress={() => finalizeMutation.mutate()} isLoading={finalizeMutation.isPending}>
              Finalize (lock)
            </Button>
          )}
          {report.status === "closed" && canFinalize && (
            <Button variant="secondary" onPress={() => setShowVariance((v) => !v)}>
              Record a correction
            </Button>
          )}
        </div>
        {report.status === "reviewed" && (
          <p className="text-xs text-text-muted">
            Finalizing requires a different person than whoever generated this report ({report.generated_by}).
          </p>
        )}
        {showVariance && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            <Select
              label="Variance type"
              options={[
                { value: "cash_variance", label: "Cash variance" },
                { value: "total_adjustment", label: "Total adjustment" },
                { value: "reclassification", label: "Reclassification" },
                { value: "other", label: "Other" },
              ]}
              value={varianceType}
              onChange={(value) => setVarianceType(String(value ?? "cash_variance"))}
            />
            <TextArea label="Reason" value={varianceReason} onChange={setVarianceReason} />
            <Button variant="primary" onPress={() => varianceMutation.mutate()} isDisabled={!varianceReason.trim()} isLoading={varianceMutation.isPending}>
              Record correction
            </Button>
          </div>
        )}
        {report.corrections.length > 0 && (
          <div className="border-t border-border pt-3">
            <h3 className="mb-2 text-sm font-medium text-text">Linked corrections</h3>
            <ul className="flex flex-col gap-1 text-sm text-text-secondary">
              {report.corrections.map((correction) => (
                <li key={correction.id}>
                  {correction.correction_number} — {correction.variance_type}: {correction.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
