"use client";

// CRM › Setup › Holidays (CRM plan 5.6): the organization's days off. Reminders that would fall on one move to the next working day,
// and a follow-up planned on one shows the holiday.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Trash2 } from "lucide-react";
import { Button, Checkbox, Dialog, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { addHoliday, errorMessage, listHolidays, removeHoliday } from "@/features/crm/shared/gst-api";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";
import { GST_STATES } from "@/features/crm/shared/gst-states";
import { formatDate } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function HolidaysScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const key = scopedQueryKey(workspace, "crm", "holidays", year);
  const query = useQuery({ queryKey: key, queryFn: () => listHolidays(year), enabled: canManage });
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "holidays") }); };
  const add = useMutation({ mutationFn: () => addHoliday({ date, name }), onSuccess: () => { setDate(""); setName(""); refresh(); }, onError: (failure) => setError(errorMessage(failure)) });
  const remove = useMutation({ mutationFn: (id: string) => removeHoliday(id), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const [presetsOpen, setPresetsOpen] = useState(false);

  if (!canManage) return <PermissionState title="You can't manage holidays" description="Ask an administrator for the Manage CRM settings permission." />;
  const holidays = query.data ?? [];
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Holidays" description="Days with no working hours. Reminders that would fall on one move to the next working day, and follow-ups planned on one show it."
        primaryAction={<Button variant="primary" onPress={() => setPresetsOpen(true)}><CalendarPlus className="size-4" aria-hidden="true" />Add state holidays</Button>} />
      {presetsOpen && <StatePresetsDialog year={year} onClose={() => setPresetsOpen(false)} onAdded={refresh} />}
      {error && <Notice>{error}</Notice>}

      {/* Desktop: the year's holidays on the left, adding one on the right. Tablet and phone: adding one first, then the list. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        <section aria-labelledby="add-holiday" className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 lg:order-2">
          <h2 id="add-holiday" className="text-sm font-semibold text-text">Add a holiday</h2>
          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end lg:grid-cols-1">
            <DateInput label="Date" value={date} onChange={setDate} />
            <TextField label="Holiday" value={name} onChange={setName} maxLength={80} placeholder="For example: Diwali" />
            <Button variant="primary" isLoading={add.isPending} isDisabled={!date || !name.trim()} onPress={() => add.mutate()}>Add holiday</Button>
          </div>
          <p className="border-t border-border pt-3 text-xs text-text-muted">Republic Day, Independence Day and Gandhi Jayanti are always holidays. Add state holidays for the festivals and state days.</p>
        </section>

        <section aria-labelledby="holiday-list" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface lg:order-1">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id="holiday-list" className="text-sm font-semibold text-text">
              {query.isSuccess ? `${holidays.length} ${holidays.length === 1 ? "holiday" : "holidays"} in ${year}` : `Holidays in ${year}`}
            </h2>
            <Select aria-label="Year" size="compact" className="w-28" selectedKey={String(year)} onSelectionChange={(next) => setYear(Number(next))}
              options={[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((entry) => ({ value: String(entry), label: String(entry) }))} />
          </div>
          {query.isLoading ? <div className="p-4"><LoadingState label="Loading holidays" rows={4} /></div> : query.isError ? (
            <div className="p-4"><ErrorState title="Could not load the holidays" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} /></div>
          ) : holidays.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-text-secondary">{`No holidays in ${year}. Add your state's holidays, or one by date.`}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {holidays.map((holiday) => {
                const day = new Date(`${String(holiday.date).slice(0, 10)}T00:00:00`);
                return (
                  <li key={holiday.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="flex w-11 shrink-0 flex-col items-center rounded-[var(--radius-control)] border border-border py-1 leading-tight" aria-hidden="true">
                      <span className="text-[10px] font-semibold uppercase text-brand">{day.toLocaleDateString(undefined, { month: "short" })}</span>
                      <span className="text-base font-semibold tabular-nums text-text">{day.getDate()}</span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-text">{holiday.name}</span>
                        {holiday.national && <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-text-secondary">National</span>}
                      </span>
                      <span className="text-xs text-text-muted">{day.toLocaleDateString(undefined, { weekday: "long" })} · {formatDate(holiday.date)}</span>
                    </span>
                    {/* The national holidays are always holidays: nothing to remove. */}
                    {!holiday.national && (
                      <Button variant="ghost" size="compact" aria-label={`Remove ${holiday.name}`} isDisabled={remove.isPending} onPress={() => remove.mutate(holiday.id)}>
                        <Trash2 className="size-4" aria-hidden="true" /><span>Remove</span>
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

class PresetError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(PresetError, "body");
type Preset = { date: string; name: string; check: boolean };

// The festivals and state days of a state for a year (CRM audit): all ticked; the ones that move each year say so.
function StatePresetsDialog({ year, onClose, onAdded }: { year: number; onClose: () => void; onAdded: () => void }) {
  const workspace = useWorkspaceContext();
  const [state, setState] = useState("");
  const [presetYear, setPresetYear] = useState(year);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const presets = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "holiday-presets", presetYear, state),
    queryFn: () => request<{ years: number[]; presets: Preset[] }>(`/api/crm/holidays/presets?year=${presetYear}${state ? `&state=${state}` : ""}`),
    retry: false,
  });
  const add = useMutation({
    mutationFn: () => request<{ added: number }>("/api/crm/holidays/presets", { method: "POST",
      json: { year: presetYear, state: state || null, dates: (presets.data?.presets ?? []).filter((entry) => !unticked.has(entry.date)).map((entry) => entry.date) } }),
    onSuccess: () => { onAdded(); onClose(); },
  });
  const years = presets.data?.years ?? [2026, 2027];
  const list = presets.data?.presets ?? [];
  const ticked = list.filter((entry) => !unticked.has(entry.date)).length;
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Add state holidays" size="lg"
      description="Your state's festivals and state days for the year. Untick any your business works on."
      footer={<>
        <Button variant="secondary" onPress={onClose}>Cancel</Button>
        <Button variant="primary" isLoading={add.isPending} isDisabled={!presets.data || ticked === 0} onPress={() => add.mutate()}>
          {ticked ? `Add ${ticked} ${ticked === 1 ? "holiday" : "holidays"}` : "Add holidays"}
        </Button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <Select label="State" selectedKey={state || "none"} onSelectionChange={(key) => { setState(String(key) === "none" ? "" : String(key)); setUnticked(new Set()); }}
            options={[{ value: "none", label: "All-India holidays only" }, ...GST_STATES.filter((entry) => entry.code !== "97").map((entry) => ({ value: entry.code, label: entry.name }))]} />
          <Select label="Year" selectedKey={String(presetYear)} onSelectionChange={(key) => { setPresetYear(Number(key)); setUnticked(new Set()); }}
            options={years.map((entry) => ({ value: String(entry), label: String(entry) }))} />
        </div>
        {presets.isError && <Notice>{presets.error instanceof Error ? presets.error.message : "The holidays could not be loaded."}</Notice>}
        {add.isError && <Notice>{add.error instanceof Error ? add.error.message : "The holidays could not be added."}</Notice>}
        {list.length > 0 && (
          <div className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted px-3 py-2 text-xs text-text-secondary">
              <span>{`${ticked} of ${list.length} ticked`}</span>
              <span className="flex gap-1">
                <Button variant="ghost" size="compact" onPress={() => setUnticked(new Set())}>Tick all</Button>
                <Button variant="ghost" size="compact" onPress={() => setUnticked(new Set(list.map((entry) => entry.date)))}>Untick all</Button>
              </span>
            </div>
            <ul className="flex flex-col divide-y divide-border">
              {list.map((entry) => (
                <li key={entry.date} className="px-3 py-2">
                  <Checkbox isSelected={!unticked.has(entry.date)} onChange={(on) => setUnticked((current) => { const next = new Set(current); if (on) next.delete(entry.date); else next.add(entry.date); return next; })}>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="w-24 shrink-0 tabular-nums text-text-secondary">{formatDate(entry.date)}</span>
                      <span className="font-medium text-text">{entry.name}</span>
                      {entry.check && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">Check the date</span>}
                    </span>
                  </Checkbox>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-text-muted">Festivals follow the lunar calendar, so check the dates marked “Check the date” against your state&apos;s official list. A date that is already a holiday is kept.</p>
      </div>
    </Dialog>
  );
}
