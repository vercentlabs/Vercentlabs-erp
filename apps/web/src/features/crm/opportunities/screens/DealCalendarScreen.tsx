"use client";

// The deals by expected close date, a month at a time (CRM plan 5.5). Open deals by default; won and lost ones on request. Each day
// lists its deals with their value; the month's total is above.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ErrorState, LinkButton, PageHeader, Select } from "@vercentlabs/design-system";

import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { listOpportunities, type Opportunity } from "../api/opportunities-api";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

export function DealCalendarScreen() {
  const workspace = useWorkspaceContext();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [status, setStatus] = useState("open");
  const [view, setView] = useState("all");
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const from = iso(cursor.year, cursor.month, 1);
  const to = iso(cursor.year, cursor.month, days);
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "opportunities", "calendar", from, status, view),
    queryFn: () => listOpportunities({ expectedCloseFrom: from, expectedCloseTo: to, status: status === "all" ? undefined : status, view: view as "all", limit: 500 }),
  });
  const byDay = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const deal of query.data?.rows ?? []) {
      if (!deal.expectedCloseDate) continue;
      const list = map.get(deal.expectedCloseDate) ?? [];
      list.push(deal);
      map.set(deal.expectedCloseDate, list);
    }
    return map;
  }, [query.data]);
  // Monday-first grid: blanks before the 1st.
  const lead = (new Date(cursor.year, cursor.month, 1).getDay() + 6) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const move = (offset: number) => setCursor(({ year, month }) => {
    const next = new Date(year, month + offset, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  });
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Deal calendar" description="Deals by the date they are expected to close."
        secondaryActions={<><LinkButton variant="outline" href="/crm/opportunities">List</LinkButton><LinkButton variant="outline" href="/crm/pipeline">Board</LinkButton></>} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="compact" aria-label="Previous month" onPress={() => move(-1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
          <span className="min-w-40 text-center font-semibold">{monthLabel}</span>
          <Button variant="ghost" size="compact" aria-label="Next month" onPress={() => move(1)}><ChevronRight className="size-4" aria-hidden="true" /></Button>
          <Button variant="ghost" size="compact" onPress={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>Today</Button>
        </div>
        <Select aria-label="Status" size="compact" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
          options={[{ value: "open", label: "Open deals" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All" }]} />
        <Select aria-label="Whose" size="compact" selectedKey={view} onSelectionChange={(key) => setView(String(key))}
          options={[{ value: "all", label: "All I can see" }, { value: "mine", label: "Mine" }, { value: "team", label: "My team" }]} />
        {query.data && <span className="text-sm text-text-secondary">{query.data.total} {query.data.total === 1 ? "deal" : "deals"} · {formatMoney(undefined, query.data.totalValue)}</span>}
      </div>
      {query.isLoading ? <LoadingState label="Loading the calendar" rows={6} /> : query.isError ? (
        <ErrorState title="Could not load the deals" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[42rem] grid-cols-7 gap-px rounded-[var(--radius-card)] border border-border bg-border text-sm">
            {WEEKDAYS.map((day) => <div key={day} className="bg-surface-muted px-2 py-1 text-xs font-medium text-text-secondary">{day}</div>)}
            {cells.map((day, index) => {
              if (day === null) return <div key={`blank-${index}`} className="min-h-24 bg-surface" />;
              const date = iso(cursor.year, cursor.month, day);
              const deals = byDay.get(date) ?? [];
              return (
                <div key={date} className={`flex min-h-24 flex-col gap-1 bg-surface p-1.5 ${date === todayIso ? "ring-2 ring-inset ring-brand" : ""}`}>
                  <span className="text-xs text-text-muted">{day}</span>
                  {deals.slice(0, 4).map((deal) => (
                    <Link key={deal.id} href={`/crm/opportunities/${deal.id}`} className="truncate rounded bg-brand/10 px-1 py-0.5 text-xs hover:underline"
                      title={`${deal.name} · ${deal.accountName ?? ""}`}>
                      {deal.name} · {formatMoney(deal.currencyCode ?? undefined, deal.amount)}
                    </Link>
                  ))}
                  {deals.length > 4 && <Link className="text-xs text-brand hover:underline" href={`/crm/opportunities?expectedCloseFrom=${date}&expectedCloseTo=${date}`}>+{deals.length - 4} more</Link>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
