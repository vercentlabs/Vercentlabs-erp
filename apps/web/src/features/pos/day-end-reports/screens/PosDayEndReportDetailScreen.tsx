"use client";

import { useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, MetricStrip, PermissionState, RecordHeader, Select, StatusBadge, TextArea } from "@vercentlabs/design-system";
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
import { generatePosReconciliation, listPosReconciliations } from "@/features/pos/reconciliation/api/reconciliation-api";
import { postPosDayEndReportToAccounting } from "@/features/pos/accounting/api/accounting-api";
import { calendarDate, dateTime, money, statusLabel, statusTone } from "@/features/pos/shared/format";
import { PosAlert, PosBackLink, PosDataTable, PosFacts, PosLoading, PosPanel } from "@/features/pos/shared/PosUi";

type Tender = { method: string; amount: string; count: number };
type Lineage = { shiftIds: string[]; saleIds: string[]; returnIds: string[]; cashMovementIds: string[] };
type Correction = { id: string; correction_number: string; variance_type: string; reason: string; created_at: string };

const VARIANCE_TYPES = [
  { value: "cash_variance", label: "Cash variance" },
  { value: "total_adjustment", label: "Total adjustment" },
  { value: "reclassification", label: "Reclassification" },
  { value: "other", label: "Other" },
];

// F303 -- the Z report itself (sales / tender / cash sections) is the
// printable document; the header chrome, lineage, reconciliation, posting
// and workflow panels are on-screen controls and are print:hidden, so a
// printout is exactly the report and nothing else.
export function PosDayEndReportDetailScreen({ reportId }: { reportId: string }) {
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
  const [postingSummary, setPostingSummary] = useState<{ posted: number; alreadyPosted: number; failed: number } | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "day-end-report", reportId),
    queryFn: () => getPosDayEndReport(reportId),
    retry: (failureCount, error) => !(error instanceof PosApiError && (error.status === 403 || error.status === 404)) && failureCount < 2,
  });

  const isClosed = query.data?.report.status === "closed";
  const reconciliationsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "pos", "reconciliations", "report", reportId),
    queryFn: () => listPosReconciliations({ dayEndReportId: reportId }),
    enabled: isClosed,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "day-end-report", reportId) });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "day-end-reports") });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "pos", "reconciliations") });
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
    onSuccess: () => {
      setActionError(null);
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

  if (query.isLoading) return <PosLoading label="Loading day-end report…" />;
  if (query.isError || !query.data) {
    if (query.error instanceof PosApiError && query.error.status === 403) {
      return <PermissionState title="You don't have access to this report" description="This report belongs to a store you are not assigned to." />;
    }
    return <ErrorState title="Could not load this day-end report" action={{ label: "Retry", onPress: () => query.refetch() }} />;
  }

  const report = query.data.report as typeof query.data.report & {
    tender_totals: Tender[];
    lineage: Lineage;
    corrections: Correction[];
  };
  const reconciliations = reconciliationsQuery.data?.rows ?? [];
  const scopeLabel = report.scope_type === "shift" ? "Per-shift report" : "Business-day report";

  return (
    <div className="flex flex-col gap-4 print:gap-3 print:p-0">
      <div className="flex flex-col gap-4 print:hidden">
        <PosBackLink href="/pos/reports/day-end">All day-end reports</PosBackLink>
        <RecordHeader
          title={`Z Report ${report.report_number}`}
          status={<StatusBadge tone={statusTone(report.status)}>{statusLabel(report.status)}</StatusBadge>}
          fields={[
            { label: "Type", value: scopeLabel },
            { label: "Business date", value: calendarDate(report.business_date) },
            { label: "Generated", value: dateTime(report.created_at as string | undefined) },
          ]}
          primaryAction={
            <Button variant="secondary" onPress={() => window.print()}>
              <Printer className="size-4" aria-hidden="true" />
              Print
            </Button>
          }
        />
      </div>

      {actionError && <PosAlert className="print:hidden">{actionError}</PosAlert>}

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">Z Report {report.report_number}</h1>
        <p className="text-sm">
          {scopeLabel} · Business date {calendarDate(report.business_date)} · Status {statusLabel(report.status)}
        </p>
      </div>

      <MetricStrip
        className="print:hidden"
        metrics={[
          { label: "Grand total", value: money("", report.grand_sales_total) },
          { label: "Sales", value: report.sale_count },
          { label: "Returns / refunds", value: money("", report.return_total) },
          { label: "Cash variance", value: money("", report.cash_variance_total) },
        ]}
      />

      <PosPanel title="Sales reconciliation">
        <PosFacts
          columns={4}
          items={[
            { label: "Sales count", value: String(report.sale_count) },
            { label: "Gross sales", value: money("", report.gross_sales_total) },
            { label: "Discounts", value: money("", report.discount_total) },
            { label: "Tax", value: money("", report.tax_total) },
            { label: "Net sales", value: money("", report.net_sales_total) },
            { label: "Rounding", value: money("", report.rounding_total) },
            { label: "Grand total", value: money("", report.grand_sales_total) },
            { label: "Returns count", value: String(report.return_count) },
            { label: "Returns / refunds", value: money("", report.return_total) },
          ]}
        />
      </PosPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 print:grid-cols-1">
        <PosPanel title="Tender breakdown">
          <PosDataTable
            rows={report.tender_totals}
            empty="No payments in scope."
            columns={[
              { key: "method", header: "Method", render: (row) => statusLabel(row.method) },
              { key: "count", header: "Count", numeric: true },
              { key: "amount", header: "Amount", numeric: true, render: (row) => money("", row.amount) },
            ]}
          />
        </PosPanel>

        <PosPanel title="Cash reconciliation">
          <PosFacts
            columns={2}
            items={[
              { label: "Opening cash", value: money("", report.opening_cash_total) },
              { label: "Paid in", value: money("", report.paid_in_total) },
              { label: "Paid out", value: money("", report.paid_out_total) },
              { label: "Expected cash", value: money("", report.expected_cash_total) },
              { label: "Counted cash", value: report.counted_cash_total != null ? money("", report.counted_cash_total) : "—" },
              { label: "Variance", value: money("", report.cash_variance_total) },
            ]}
          />
        </PosPanel>
      </div>

      <PosPanel title="Lineage" description="The records that contributed to this report." className="print:hidden">
        <PosFacts
          columns={4}
          items={[
            { label: "Shifts", value: report.lineage.shiftIds.length },
            { label: "Sales", value: report.lineage.saleIds.length },
            { label: "Returns", value: report.lineage.returnIds.length },
            { label: "Cash movements", value: report.lineage.cashMovementIds.length },
          ]}
        />
      </PosPanel>

      <PosPanel
        title="Payment reconciliation"
        description={`Status: ${statusLabel(report.reconciliation_status)} · ${report.reconciliation_references.length} reference(s), ${report.outstanding_exceptions.length} outstanding exception(s).`}
        actions={
          report.status === "closed" && canReconcile ? (
            <Button variant="secondary" size="compact" onPress={() => reconcileMutation.mutate()} isLoading={reconcileMutation.isPending}>
              Generate reconciliation
            </Button>
          ) : undefined
        }
        className="print:hidden"
      >
        {report.status !== "closed" ? (
          <p className="text-sm text-text-muted">Reconciliation can be generated once this report is finalized.</p>
        ) : (
          <PosDataTable
            rows={reconciliations}
            empty="No reconciliation has been generated for this report yet."
            columns={[
              { key: "reconciliation_number", header: "Reconciliation", render: (row) => row.reconciliation_number ?? "—" },
              { key: "payment_method", header: "Method", render: (row) => statusLabel(row.payment_method) },
              { key: "expected_amount", header: "Expected", numeric: true, render: (row) => money("", row.expected_amount) },
              { key: "settled_amount", header: "Settled", numeric: true, render: (row) => money("", row.settled_amount) },
              { key: "variance_amount", header: "Variance", numeric: true, render: (row) => money("", row.variance_amount) },
              { key: "status", header: "Status", render: (row) => <StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge> },
            ]}
          />
        )}
        {reconciliations.some((row) => row.status === "variance") && (
          <p className="text-xs text-text-muted">
            Exceptions with a variance need investigation — resolve them on the{" "}
            <Link href="/pos/reconciliation" className="font-medium text-brand hover:underline">
              Reconciliation
            </Link>{" "}
            screen.
          </p>
        )}
      </PosPanel>

      <PosPanel
        title="Accounting posting"
        description="Posts this report's sales and returns to the general ledger through Accounting's own journal contract."
        actions={
          report.status === "closed" && canPostAccounting ? (
            <Button variant="secondary" size="compact" onPress={() => postAccountingMutation.mutate()} isLoading={postAccountingMutation.isPending}>
              Post to accounting
            </Button>
          ) : undefined
        }
        className="print:hidden"
      >
        {postingSummary ? (
          <p className="text-sm text-text-secondary">
            {postingSummary.posted} posted, {postingSummary.alreadyPosted} already posted, {postingSummary.failed} failed.
            {postingSummary.failed > 0 && (
              <>
                {" "}
                See the{" "}
                <Link href="/pos/accounting" className="font-medium text-brand hover:underline">
                  Accounting posting
                </Link>{" "}
                screen for failure details and retry.
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-text-muted">{report.status === "closed" ? "Not posted from this screen yet." : "Available once this report is finalized."}</p>
        )}
      </PosPanel>

      <PosPanel title="Workflow" className="print:hidden">
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
            <Button variant="secondary" onPress={() => setShowVariance((visible) => !visible)}>
              Record a correction
            </Button>
          )}
        </div>
        {report.status === "reviewed" && (
          <p className="text-xs text-text-muted">
            Finalizing needs a different person from whoever generated this report
            {report.generated_by === workspace.userId ? " — that was you, so ask a colleague with finalize authority." : "."}
          </p>
        )}
        {showVariance && (
          <div className="flex max-w-lg flex-col gap-3 border-t border-border pt-3">
            <Select label="Variance type" options={VARIANCE_TYPES} selectedKey={varianceType} onSelectionChange={(key) => setVarianceType(String(key ?? "cash_variance"))} />
            <TextArea label="Reason" value={varianceReason} onChange={setVarianceReason} />
            <div>
              <Button variant="primary" onPress={() => varianceMutation.mutate()} isDisabled={!varianceReason.trim()} isLoading={varianceMutation.isPending}>
                Record correction
              </Button>
            </div>
          </div>
        )}
        {report.corrections.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <h3 className="text-sm font-semibold text-text">Linked corrections</h3>
            <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-control)] border border-border text-sm">
              {report.corrections.map((correction) => (
                <li key={correction.id} className="flex flex-col gap-0.5 px-3 py-2">
                  <span className="font-medium text-text">
                    {correction.correction_number} · {statusLabel(correction.variance_type)}
                  </span>
                  <span className="text-text-secondary">{correction.reason}</span>
                  <span className="text-xs text-text-muted">{dateTime(correction.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </PosPanel>
    </div>
  );
}
