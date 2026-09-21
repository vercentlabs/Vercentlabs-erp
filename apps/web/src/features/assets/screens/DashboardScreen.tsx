"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@vercentlabs/design-system";

import { AssetsApiError, readView } from "@/features/assets/shared/client";
import { AssetsAlert, AssetsPanel } from "@/features/assets/shared/AssetsUi";
import { label, money } from "@/features/assets/shared/format";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

type Desk = Record<string, unknown> & { assetsByStatus?: Record<string, number> };

const ATTENTION: Array<[string, string, string]> = [
  ["pendingApprovals", "Awaiting approval", "/assets/transfers"],
  ["openWorkOrders", "Open work orders", "/assets/work-orders"],
  ["maintenanceOverdue", "Maintenance overdue", "/assets/maintenance-plans"],
  ["warrantiesExpiring", "Warranties expiring", "/assets/warranties"],
  ["calibrationsDue", "Calibrations due", "/assets/calibration"],
  ["openVerificationDiscrepancies", "Open verification discrepancies", "/assets/physical-verification"],
];
const SHORTCUTS = [["Asset register", "/assets/register"], ["Depreciation", "/assets/depreciation"], ["Work orders", "/assets/work-orders"], ["Verification", "/assets/physical-verification"], ["Reports", "/assets/reports"]] as const;

export function AssetsDashboardScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "dashboard"), queryFn: async () => (await readView<{ dashboard: Desk }>("dashboard")).dashboard });
  const d = query.data;
  const error = query.error instanceof AssetsApiError ? query.error.message : query.isError ? "The dashboard could not be loaded." : null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Assets" description="Register, custody, value, maintenance, verification and disposal, in one place." />
      {error && <AssetsAlert>{error}</AssetsAlert>}
      {d && (
        <>
          <AssetsPanel title="Portfolio">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-text-muted">Assets in service or draft</dt><dd className="text-xl font-semibold tabular-nums">{String(d.totalAssets)}</dd></div>
              {d.totalNetBookValue !== undefined ? (
                <>
                  <div><dt className="text-xs text-text-muted">Cost</dt><dd className="text-xl font-semibold tabular-nums">{money(d.totalCost)}</dd></div>
                  <div><dt className="text-xs text-text-muted">Accumulated depreciation</dt><dd className="text-xl font-semibold tabular-nums">{money(d.totalAccumulatedDepreciation)}</dd></div>
                  <div><dt className="text-xs text-text-muted">Net book value</dt><dd className="text-xl font-semibold tabular-nums">{money(d.totalNetBookValue)}</dd></div>
                </>
              ) : (
                <div className="sm:col-span-3 text-sm text-text-muted">Financial figures are shown only to people with financial access.</div>
              )}
            </dl>
          </AssetsPanel>
          <AssetsPanel title="By status">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(d.assetsByStatus ?? {}).map(([k, v]) => (
                <div key={k}><dt className="text-xs text-text-muted">{label(k)}</dt><dd className="text-xl font-semibold tabular-nums">{v}</dd></div>
              ))}
            </dl>
          </AssetsPanel>
          <AssetsPanel title="Needs attention">
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ATTENTION.map(([key, text, href]) => (
                <li key={key}>
                  <Link href={href} className="flex items-baseline justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm hover:bg-surface-hover">
                    <span>{text}</span>
                    <span className="text-lg font-semibold tabular-nums">{String(d[key] ?? 0)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </AssetsPanel>
        </>
      )}
      <AssetsPanel title="Go to">
        <div className="flex flex-wrap gap-2">
          {SHORTCUTS.map(([text, href]) => (
            <Link key={href} href={href} className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm font-medium text-brand hover:bg-surface-hover">{text}</Link>
          ))}
        </div>
      </AssetsPanel>
    </div>
  );
}
