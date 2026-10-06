"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  EnterpriseDataGrid,
  ErrorState,
  PageHeader,
  PermissionState,
  Tab,
  TabList,
  TabPanel,
  Tabs,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { request, SalesApiError } from "@/features/sales/shared/http";
import {
  calendarDate,
  dateTime,
  money,
  statusLabel,
} from "@/features/sales/shared/format";
import { SalesPanel } from "@/features/sales/shared/SalesUi";

type ReportRow = Record<string, unknown> & { _row: number };

// --------------------------------------------------------------- reports
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;
const SIX_DECIMALS = /^-?\d+\.\d{6}$/;
function cell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  // Plain dates arrive as a UTC timestamp of local midnight; read them in local
  // time, or 25 Sept shows as 24 Sept.
  if (typeof value === "string" && ISO_TIMESTAMP.test(value))
    return /(period|_at)$/.test(key)
      ? key === "period"
        ? localDay(value).slice(0, 7)
        : dateTime(value)
      : calendarDate(localDay(value));
  if (typeof value === "string" && SIX_DECIMALS.test(value))
    return /percent/.test(key)
      ? `${Number(value).toFixed(1)}%`
      : money("", value);
  if (typeof value === "string" && /^[a-z]+(_[a-z]+)+$/.test(value))
    return statusLabel(value);
  if (
    typeof value === "string" &&
    /^[a-z_]+$/.test(value) &&
    /status|type/.test(key)
  )
    return statusLabel(value);
  return String(value);
}

const localDay = (value: string) => {
  const day = new Date(value);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};
// F060: every figure leads back to its source record.
const LINKS: Record<string, { idKey: string; href: (id: string) => string }> = {
  sales_order_number: {
    idKey: "sales_order_id",
    href: (id) => `/sales/orders/${id}`,
  },
  quotation_number: { idKey: "id", href: (id) => `/sales/quotations/${id}` },
};

function ReportTable({ reportKey }: { reportKey: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "sales", "report", reportKey),
    queryFn: () =>
      request<{ rows: Array<Record<string, unknown>> }>(
        `/reports/${reportKey}`,
      ).then((r) =>
        r.rows.map((row, index) => ({ ...row, _row: index }) as ReportRow),
      ),
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const columns: ColumnDef<ReportRow, unknown>[] = useMemo(() => {
    const keys = Object.keys(rows[0] ?? {}).filter(
      (key) => key !== "_row" && key !== "id" && !key.endsWith("_id"),
    );
    return keys.map((key) => {
      const link = LINKS[key];
      return {
        id: key,
        header: statusLabel(key.replace(/_pct$/, "_percent")),
        accessorFn: (row: ReportRow) =>
          key.endsWith("_pct") && row[key] != null
            ? `${row[key]}%`
            : cell(key, row[key]),
        ...(link
          ? {
              cell: ({ row }: { row: { original: ReportRow } }) =>
                row.original[link.idKey] ? (
                  <Link
                    href={link.href(String(row.original[link.idKey]))}
                    className="font-medium text-brand hover:underline"
                  >
                    {String(row.original[key])}
                  </Link>
                ) : (
                  String(row.original[key] ?? "—")
                ),
            }
          : {}),
      };
    });
  }, [rows]);
  if (query.isError) {
    if (query.error instanceof SalesApiError && query.error.status === 403)
      return (
        <PermissionState
          title="You don't have access to this report"
          description="It needs an additional permission."
        />
      );
    return (
      <ErrorState
        title="Could not load this report"
        action={{ label: "Retry", onPress: () => query.refetch() }}
      />
    );
  }
  return (
    <EnterpriseDataGrid<ReportRow>
      aria-label={statusLabel(reportKey.replace(/-/g, " "))}
      columns={columns}
      data={rows}
      getRowId={(row) => String(row._row)}
      density="compact"
      state={
        query.isLoading ? "loading" : rows.length === 0 ? "empty" : "ready"
      }
      loadingContent={
        <p className="px-4 py-8 text-sm text-text-secondary">Loading…</p>
      }
      emptyContent={
        <p className="px-4 py-8 text-sm text-text-muted">
          No data for this report yet.
        </p>
      }
    />
  );
}

export type ReportSpec = { key: string; label: string; description: string };
export function SalesReportScreen({
  title,
  description,
  reports,
}: {
  title: string;
  description: string;
  reports: ReportSpec[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={title} description={description} />
      <Tabs>
        <TabList aria-label={`${title} reports`}>
          {reports.map((report) => (
            <Tab key={report.key} id={report.key}>
              {report.label}
            </Tab>
          ))}
        </TabList>
        {reports.map((report) => (
          <TabPanel
            key={report.key}
            id={report.key}
            className="flex flex-col gap-3"
          >
            <SalesPanel title={report.label} description={report.description}>
              <ReportTable reportKey={report.key} />
            </SalesPanel>
          </TabPanel>
        ))}
      </Tabs>
    </div>
  );
}

export const SALES_REPORTS: ReportSpec[] = [
  {
    key: "order-status",
    label: "Order status",
    description:
      "Every confirmed or closed order with each dimension on its own: reservation, fulfillment, invoicing and payment, and what needs attention. Select an order to open it.",
  },
  {
    key: "fulfillment",
    label: "Remaining by order",
    description: "Confirmed orders with goods still to deliver: ordered, delivered, cancelled and remaining, and whether the requested date has passed.",
  },
  {
    key: "remaining-by-product",
    label: "Remaining by product",
    description: "Open delivery demand per product across confirmed orders, and how much of it is reserved.",
  },
  {
    key: "delivery-performance",
    label: "Delivery performance",
    description: "Each dispatched delivery against the date the customer requested.",
  },
  {
    key: "billing-readiness",
    label: "Billing readiness",
    description: "Orders ready, partly or blocked from invoicing.",
  },
  {
    key: "pending-approvals",
    label: "Pending approvals",
    description: "Quotations waiting for an approver.",
  },
  {
    key: "expiring-quotations",
    label: "Expiring quotations",
    description: "Sent quotations about to lapse.",
  },
];
