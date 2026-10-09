"use client";

// The Procurement Overview, in CRM's shape: four headline figures, the purchasing work in progress and what needs attention side by side, and
// the documents that need someone to act. Each figure opens the list behind it; a figure the person may not see is not sent by the server.
// New documents start from the Create menu, as on every module's overview.
import { useQuery } from "@tanstack/react-query";
import { ErrorState, PermissionState } from "@vercentlabs/design-system";

import { calendarDate } from "@/features/procurement/shared/format";
import { ProcApiError } from "@/features/procurement/shared/http";
import { ModuleCreateMenu } from "@/shell/app-shell/ModuleCreateMenu";
import { LoadingState } from "@/shared/ui/LoadingState";
import { ActivityList, CountList, OverviewCards, OverviewHeader, OverviewPanel, type CountRow } from "@/shared/ui/overview";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getProcurementOverview, type ProcurementMetric } from "./api";

const HEADLINE = ["open_orders", "pending_receipts", "bill_mismatches", "overdue_bills"];
const WORK = ["open_orders", "pending_receipts", "unresolved_returns", "pending_credits"];
const ATTENTION: Record<string, CountRow["tone"]> = { receiving_issues: "warning", bill_mismatches: "warning", overdue_bills: "danger" };

export function ProcurementHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "procurement", "overview"), queryFn: getProcurementOverview });
  if (query.isError && query.error instanceof ProcApiError && query.error.status === 403)
    return <PermissionState title="You don't have access to Procurement" description="Ask an administrator for a Procurement role." />;
  const data = query.data;
  const metric = (key: string): ProcurementMetric | undefined => data?.metrics.find((entry) => entry.key === key);
  const rows = (keys: string[], tones: Record<string, CountRow["tone"]> = {}): CountRow[] =>
    keys.map((key) => metric(key)).filter((entry): entry is ProcurementMetric => Boolean(entry))
      .map((entry) => ({ label: entry.label, value: entry.value, href: entry.href, tone: tones[entry.key] }));

  return (
    <div className="flex flex-1 flex-col gap-6">
      <OverviewHeader description={data ? `What needs action in Procurement today (${calendarDate(data.today)}). Every number opens the list behind it.` : "What needs action in Procurement today."}
        action={<ModuleCreateMenu moduleKey="procurement" />} />
      {query.isLoading ? <LoadingState label="Loading Procurement" rows={5} />
        : query.isError || !data ? <ErrorState title="Could not load the Procurement overview" description={query.error instanceof Error ? query.error.message : undefined} action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : (
          <>
            <OverviewCards label="Overview" cards={HEADLINE.map((key) => metric(key)).filter((entry): entry is ProcurementMetric => Boolean(entry))
              .map((entry) => ({ label: entry.label, value: entry.value, href: entry.href }))} />

            <div className="grid gap-6 lg:grid-cols-2">
              <OverviewPanel title="Purchasing work">
                <CountList rows={rows(WORK)} empty="You cannot see purchase orders or returns." />
              </OverviewPanel>
              <OverviewPanel title="Needs attention">
                <CountList rows={rows(Object.keys(ATTENTION), ATTENTION)} empty="Nothing needs attention." />
              </OverviewPanel>
            </div>

            <OverviewPanel title="Documents needing action">
              <ActivityList empty="Every receipt, bill and return is up to date." entries={data.attention.map((item) => ({
                key: `${item.kind}-${item.href}`, href: item.href, title: item.title, summary: item.kind, meta: item.detail,
              }))} />
            </OverviewPanel>
          </>
        )}
    </div>
  );
}
