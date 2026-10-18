"use client";

// CRM › Setup › Holidays (CRM plan 5.6): the organization's days off. Reminders that would fall on one move to the next working day,
// and a follow-up planned on one shows the holiday.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { addHoliday, addNationalHolidays, errorMessage, listHolidays, removeHoliday } from "@/features/crm/shared/gst-api";
import { DateInput } from "@/features/crm/shared/ui/DateTimeInput";
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

  if (!canManage) return <PermissionState title="You can't manage holidays" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-6">
      <SetupBackLink />
      <PageHeader title="Holidays" description="Days with no working hours. Reminders that would fall on one move to the next working day, and follow-ups planned on one show it."
        secondaryActions={<Button variant="secondary" isLoading={national.isPending} onPress={() => national.mutate()}>{`Add national holidays for ${year}`}</Button>} />
      {error && <Notice>{error}</Notice>}
      <div className="flex max-w-3xl flex-wrap items-end gap-3">
        <Select label="Year" selectedKey={String(year)} onSelectionChange={(next) => setYear(Number(next))}
          options={[thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((entry) => ({ value: String(entry), label: String(entry) }))} />
        <DateInput label="Date" value={date} onChange={setDate} />
        <TextField label="Holiday" value={name} onChange={setName} maxLength={80} placeholder="For example: Diwali" />
        <Button variant="primary" isLoading={add.isPending} isDisabled={!date || !name.trim()} onPress={() => add.mutate()}>Add</Button>
      </div>
      <p className="max-w-3xl text-sm text-text-secondary">National holidays are Republic Day, Independence Day and Gandhi Jayanti. Festivals and state holidays move each year: add them by date.</p>
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
