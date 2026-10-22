"use client";

// The deals by expected close date, a month at a time (CRM plan 5.5). Open deals by default; won and lost ones on request. Each day
// lists its deals with their value; the month's total is above. A phone gets the same month as a list of the days that have deals.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, ErrorState, PageHeader, Select } from "@vercentlabs/design-system";

import { ViewToggle } from "@/features/crm/shared/ui/ViewToggle";
import { formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { listOpportunities, type Opportunity } from "../api/opportunities-api";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN_PER_DAY = 3;
const pad = (value: number) => String(value).padStart(2, "0");
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

export function DealCalendarScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [status, setStatus] = useState("open");
  const [view, setView] = useState("all");
  // Phone: the day tapped in the small month grid (null: the whole month listed).
  const [picked, setPicked] = useState<string | null>(null);
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
  const move = (offset: number) => {
    setPicked(null);
    setCursor(({ year, month }) => {
      const next = new Date(year, month + offset, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());
  const isThisMonth = cursor.year === today.getFullYear() && cursor.month === today.getMonth();
  const currency = query.data?.currency?.reportingCurrency ?? query.data?.rows[0]?.currencyCode ?? undefined;
  const dealDays = [...byDay.keys()].sort().filter((date) => !picked || date === picked);
  const dayHref = (date: string) => `/crm/opportunities?expectedCloseFrom=${date}&expectedCloseTo=${date}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Deal calendar" description="Deals by the date they are expected to close."
        secondaryActions={
          <ViewToggle label="Layout" value="calendar" onChange={(id) => { if (id === "board") router.push("/crm/pipeline"); if (id === "list") router.push("/crm/opportunities"); }}
            options={[{ id: "board", label: "Board" }, { id: "list", label: "List" }, { id: "calendar", label: "Calendar" }]} />
        } />

      {/* The month and its filters in one strip: the month on the left, what to show on the right; on a phone they stack. */}
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-[var(--radius-control)] border border-border sm:flex-none">
            <Button variant="ghost" size="compact" aria-label="Previous month" onPress={() => move(-1)}><ChevronLeft className="size-4" aria-hidden="true" /></Button>
            <span className="flex-1 px-2 text-center text-sm font-semibold sm:min-w-36" aria-live="polite">{monthLabel}</span>
            <Button variant="ghost" size="compact" aria-label="Next month" onPress={() => move(1)}><ChevronRight className="size-4" aria-hidden="true" /></Button>
          </div>
          <Button variant="outline" size="compact" isDisabled={isThisMonth} onPress={() => { setPicked(null); setCursor({ year: today.getFullYear(), month: today.getMonth() }); }}>Today</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Select aria-label="Status" size="compact" className="sm:w-36" selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}
            options={[{ value: "open", label: "Open deals" }, { value: "won", label: "Won" }, { value: "lost", label: "Lost" }, { value: "all", label: "All deals" }]} />
          <Select aria-label="Whose" size="compact" className="sm:w-40" selectedKey={view} onSelectionChange={(key) => setView(String(key))}
            options={[{ value: "all", label: "All I can see" }, { value: "mine", label: "Mine" }, { value: "team", label: "My team" }]} />
        </div>
      </div>

      {query.data && (
        <p className="text-sm text-text-secondary">
          <span className="font-semibold text-text">{query.data.total} {query.data.total === 1 ? "deal" : "deals"}</span> closing in {monthLabel}
          {query.data.total > 0 && <> · <span className="font-semibold text-text tabular-nums">{formatMoney(currency, query.data.totalValue)}</span></>}
        </p>
      )}

      {query.isLoading ? <LoadingState label="Loading the calendar" rows={6} /> : query.isError ? (
        <ErrorState title="Could not load the deals" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
      ) : (
        <>
          {/* Phone: a small month grid (dots for deals; tap a day to see its deals), then the days that have deals, in order. */}
          <div className="flex flex-col gap-3 sm:hidden">
            <div className="grid grid-cols-7 gap-y-1 rounded-[var(--radius-card)] border border-border bg-surface p-2 text-center" role="grid" aria-label={monthLabel}>
              {WEEKDAYS.map((day) => <span key={day} className="py-1 text-[11px] font-medium text-text-muted">{day.slice(0, 2)}</span>)}
              {cells.map((day, index) => {
                if (day === null) return <span key={`blank-${index}`} />;
                const date = iso(cursor.year, cursor.month, day);
                const count = byDay.get(date)?.length ?? 0;
                const isPicked = picked === date;
                const isToday = date === todayIso;
                return (
                  <button key={date} type="button" aria-pressed={isPicked} aria-label={`${day} ${monthLabel}${count ? `, ${count} ${count === 1 ? "deal" : "deals"}` : ""}`}
                    onClick={() => setPicked(isPicked ? null : date)}
                    className={`mx-auto flex h-11 w-10 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-control)] text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand
                      ${isPicked ? "bg-brand text-text-inverse" : isToday ? "bg-brand-soft font-semibold text-brand" : count ? "font-medium text-text" : "text-text-muted"}`}>
                    {day}
                    <span className="flex h-1 gap-0.5" aria-hidden="true">
                      {Array.from({ length: Math.min(count, 3) }, (_, dot) => <span key={dot} className={`size-1 rounded-full ${isPicked ? "bg-text-inverse" : "bg-brand"}`} />)}
                    </span>
                  </button>
                );
              })}
            </div>
            {picked && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-secondary">Showing one day</span>
                <Button variant="ghost" size="compact" onPress={() => setPicked(null)}>Show the whole month</Button>
              </div>
            )}
            {dealDays.length === 0 && <p className="rounded-[var(--radius-card)] border border-border bg-surface p-4 text-sm text-text-secondary">{picked ? "No deals close on this day." : "No deals close this month."}</p>}
            {dealDays.map((date) => {
              const deals = byDay.get(date) ?? [];
              const label = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
              return (
                <section key={date} className="rounded-[var(--radius-card)] border border-border bg-surface" aria-label={label}>
                  <header className={`flex items-center justify-between border-b border-border px-3 py-2 text-sm font-semibold ${date === todayIso ? "text-brand" : "text-text"}`}>
                    <span>{label}{date === todayIso ? " · Today" : ""}</span>
                    <span className="text-xs font-normal text-text-secondary">{deals.length} {deals.length === 1 ? "deal" : "deals"}</span>
                  </header>
                  <ul className="divide-y divide-border">
                    {deals.map((deal) => (
                      <li key={deal.id}>
                        <Link href={`/crm/opportunities/${deal.id}`} className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-surface-muted">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-text">{deal.name}</span>
                            {deal.accountName && <span className="block truncate text-xs text-text-secondary">{deal.accountName}</span>}
                          </span>
                          <span className="shrink-0 text-sm tabular-nums text-text">{formatMoney(deal.currencyCode ?? undefined, deal.amount)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>

          {/* Tablet and desktop: the month grid. */}
          <div className="hidden grid-cols-7 gap-px overflow-hidden rounded-[var(--radius-card)] border border-border bg-border text-sm sm:grid">
            {WEEKDAYS.map((day) => <div key={day} className="bg-surface-muted px-2 py-1.5 text-xs font-medium text-text-secondary">{day}</div>)}
            {cells.map((day, index) => {
              if (day === null) return <div key={`blank-${index}`} className="min-h-24 bg-surface-muted/40 lg:min-h-28" />;
              const date = iso(cursor.year, cursor.month, day);
              const deals = byDay.get(date) ?? [];
              const isToday = date === todayIso;
              return (
                <div key={date} className="flex min-h-24 min-w-0 flex-col gap-1 bg-surface p-1.5 lg:min-h-28">
                  <span className={`flex size-6 items-center justify-center rounded-full text-xs ${isToday ? "bg-brand font-semibold text-text-inverse" : "text-text-muted"}`}>{day}</span>
                  {deals.slice(0, SHOWN_PER_DAY).map((deal) => (
                    <Link key={deal.id} href={`/crm/opportunities/${deal.id}`} title={`${deal.name}${deal.accountName ? ` · ${deal.accountName}` : ""}`}
                      className="block min-w-0 rounded border-l-2 border-brand bg-brand-soft px-1.5 py-1 text-xs hover:bg-brand/15">
                      <span className="block truncate font-medium text-text">{deal.name}</span>
                      <span className="block truncate tabular-nums text-text-secondary">{formatMoney(deal.currencyCode ?? undefined, deal.amount)}</span>
                    </Link>
                  ))}
                  {deals.length > SHOWN_PER_DAY && <Link className="px-1 text-xs font-medium text-brand hover:underline" href={dayHref(date)}>+{deals.length - SHOWN_PER_DAY} more</Link>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
