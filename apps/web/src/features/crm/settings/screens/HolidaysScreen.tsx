"use client";

// CRM › Setup › Holidays (CRM plan 5.6): the organization's days off. Reminders that would fall on one move to the next working day,
// and a follow-up planned on one shows the holiday.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button, Checkbox, Dialog, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { addHoliday, addNationalHolidays, errorMessage, listHolidays, removeHoliday } from "@/features/crm/shared/gst-api";
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
  const national = useMutation({ mutationFn: () => addNationalHolidays(year), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const remove = useMutation({ mutationFn: (id: string) => removeHoliday(id), onSuccess: refresh, onError: (failure) => setError(errorMessage(failure)) });
  const [presetsOpen, setPresetsOpen] = useState(false);

  if (!canManage) return <PermissionState title="You can't manage holidays" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Holidays" description="Days with no working hours. Reminders that would fall on one move to the next working day, and follow-ups planned on one show it."
        secondaryActions={<>
          <Button variant="secondary" onPress={() => setPresetsOpen(true)}>Holidays for your state</Button>
          <Button variant="secondary" isLoading={national.isPending} onPress={() => national.mutate()}>{`Add national holidays for ${year}`}</Button>
        </>} />
      {presetsOpen && <StatePresetsDialog year={year} onClose={() => setPresetsOpen(false)} onAdded={refresh} />}
      {error && <Notice>{error}</Notice>}
      <div className="flex max-w-3xl flex-wrap items-end gap-3">
        <Select label="Year" selectedKey={String(year)} onSelectionChange={(next) => setYear(Number(next))}
          options={[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((entry) => ({ value: String(entry), label: String(entry) }))} />
        <DateInput label="Date" value={date} onChange={setDate} />
        <TextField label="Holiday" value={name} onChange={setName} maxLength={80} placeholder="For example: Diwali" />
        <Button variant="primary" isLoading={add.isPending} isDisabled={!date || !name.trim()} onPress={() => add.mutate()}>Add</Button>
      </div>
      <p className="max-w-3xl text-sm text-text-secondary">National holidays are Republic Day, Independence Day and Gandhi Jayanti. Holidays for your state adds the festivals and state days too; others can be added by date.</p>
      {query.isLoading ? <LoadingState label="Loading holidays" rows={4} /> : query.isError ? (
        <ErrorState title="Could not load the holidays" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
      ) : (query.data ?? []).length === 0 ? <p className="text-sm text-text-secondary">{`No holidays in ${year} yet.`}</p> : (
        <ul className="flex max-w-3xl flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {(query.data ?? []).map((holiday) => (
            <li key={holiday.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span><span className="font-medium">{holiday.name}</span> · {formatDate(holiday.date)}</span>
              <Button variant="ghost" size="compact" aria-label={`Remove ${holiday.name}`} isDisabled={remove.isPending} onPress={() => remove.mutate(holiday.id)}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
      )}
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
  return (
    <Dialog isOpen onOpenChange={(open) => !open && onClose()} title="Holidays for your state" size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="State" selectedKey={state || "none"} onSelectionChange={(key) => { setState(String(key) === "none" ? "" : String(key)); setUnticked(new Set()); }}
            options={[{ value: "none", label: "All-India holidays only" }, ...GST_STATES.filter((entry) => entry.code !== "97").map((entry) => ({ value: entry.code, label: entry.name }))]} />
          <Select label="Year" selectedKey={String(presetYear)} onSelectionChange={(key) => { setPresetYear(Number(key)); setUnticked(new Set()); }}
            options={years.map((entry) => ({ value: String(entry), label: String(entry) }))} />
        </div>
        {presets.isError && <Notice>{presets.error instanceof Error ? presets.error.message : "The holidays could not be loaded."}</Notice>}
        {add.isError && <Notice>{add.error instanceof Error ? add.error.message : "The holidays could not be added."}</Notice>}
        <p className="text-xs text-text-muted">Festivals follow the lunar calendar: check the dates marked “check” against your state's official holiday list. A date that is already a holiday is kept.</p>
        <ul className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {(presets.data?.presets ?? []).map((entry) => (
            <li key={entry.date}>
              <Checkbox isSelected={!unticked.has(entry.date)} onChange={(on) => setUnticked((current) => { const next = new Set(current); if (on) next.delete(entry.date); else next.add(entry.date); return next; })}>
                {`${formatDate(entry.date)} — ${entry.name}${entry.check ? " (check)" : ""}`}
              </Checkbox>
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={add.isPending} isDisabled={!presets.data} onPress={() => add.mutate()}>Add the ticked holidays</Button>
        </div>
      </div>
    </Dialog>
  );
}
