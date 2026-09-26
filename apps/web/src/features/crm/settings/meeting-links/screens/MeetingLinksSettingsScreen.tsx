"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Copy, Plus } from "lucide-react";
import {
  Button,
  Dialog,
  EnterpriseDataGrid,
  EnterpriseListPage,
  IconButton,
  NumberField,
  PermissionState,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { timezoneLabel } from "@/shared/format/human";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { archiveMeetingLink, createMeetingLink, listMeetingLinks, MeetingLinkApiError } from "../api/meeting-links-api";
import { WEEKDAYS, type MeetingLink, type MeetingLinkAvailability } from "../types";

const PROVIDER_OPTIONS: SelectOption[] = [
  { value: "manual", label: "Manual / in-person" },
  { value: "google_meet", label: "Google Meet" },
  { value: "microsoft_teams", label: "Microsoft Teams" },
  { value: "zoom", label: "Zoom" },
];

// F014 Stage A2 §5. meeting-links is a generic-resource-backed table with
// no dedicated CRM module — confirmed by grep before building this — so
// this screen (like Territories/Qualification-and-Playbooks) is the only
// place its config gets a UI. Public booking (BookMeetingScreen) reads
// exactly this row's availability/duration/buffers/provider — no separate
// config surface.
const DAY_NAMES = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_SHORT: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };

// Days with identical hours are grouped: "Mon to Fri, 09:00 to 17:00".
function summarizeAvailability(availability: MeetingLink["availability"]): string {
  const byHours = new Map<string, string[]>();
  for (const day of DAY_NAMES) {
    const windows = availability?.[day] ?? [];
    if (windows.length === 0) continue;
    const key = windows.map((w) => `${w.start} to ${w.end}`).join(", ");
    byHours.set(key, [...(byHours.get(key) ?? []), day]);
  }
  if (byHours.size === 0) return "No hours set";
  return [...byHours.entries()]
    .map(([hours, days]) => {
      const contiguous = days.length > 2 && days.every((d, i) => i === 0 || DAY_NAMES.indexOf(d as (typeof DAY_NAMES)[number]) === DAY_NAMES.indexOf(days[i - 1] as (typeof DAY_NAMES)[number]) + 1);
      return `${contiguous ? `${DAY_SHORT[days[0]]} to ${DAY_SHORT[days.at(-1)!]}` : days.map((d) => DAY_SHORT[d]).join(", ")}, ${hours}`;
    })
    .join("; ");
}

export function MeetingLinksSettingsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.settingsManage);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const linksQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "meeting-links"), queryFn: listMeetingLinks });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const links = linksQuery.data?.rows ?? [];
  const userOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.id) }));
  }, [optionsQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "meeting-links") });
  }
  function handleError(err: unknown) {
    setError(err instanceof MeetingLinkApiError ? err.message : "This action could not be completed.");
  }

  const archiveMutation = useMutation({
    mutationFn: (row: MeetingLink) => archiveMeetingLink(row.id, row.updatedAt),
    onSuccess: invalidate,
    onError: handleError,
  });

  async function copyBookingLink(link: MeetingLink) {
    const url = `${window.location.origin}/book/${link.publicToken}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(link.id);
    window.setTimeout(() => setCopiedId((current) => (current === link.id ? null : current)), 2000);
  }

  const columns: ColumnDef<MeetingLink, unknown>[] = useMemo(
    () => [
      {
        id: "name",
        header: "Meeting",
        accessorKey: "name",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium text-text">{row.original.name}</span>
            <span className="max-w-xs truncate text-xs text-text-muted">{`/book/${row.original.publicToken}`}</span>
          </div>
        ),
      },
      { id: "duration", header: "Length", accessorFn: (row) => (row.durationMinutes < 60 ? `${row.durationMinutes} minutes` : row.durationMinutes % 60 === 0 ? `${row.durationMinutes / 60} hour${row.durationMinutes === 60 ? "" : "s"}` : `${row.durationMinutes} minutes`) },
      { id: "availability", header: "Available", accessorFn: (row) => summarizeAvailability(row.availability) },
      { id: "timezone", header: "Time zone", accessorFn: (row) => timezoneLabel(row.timezone) },
      { id: "provider", header: "Held on", accessorFn: (row) => PROVIDER_OPTIONS.find((option) => option.value === row.meetingProvider)?.label || row.meetingProvider },
      {
        id: "status",
        header: "State",
        accessorKey: "status",
        cell: ({ getValue }) => <StatusBadge tone={getValue() === "active" ? "success" : "neutral"}>{getValue() === "active" ? "Accepting bookings" : "Archived"}</StatusBadge>,
      },
    ],
    [],
  );

  if (!canManage) return <PermissionState title="You don't have access to CRM Setup" description="Ask an administrator to grant crm.settings.manage." />;

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <EnterpriseListPage
        header={{
          title: "Meeting links",
          description: "Booking pages you share so customers can pick a time when you are free.",
          primaryAction: (
            <Button variant="primary" onPress={() => setDialogOpen(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New meeting link
            </Button>
          ),
        }}
      >
        <EnterpriseDataGrid<MeetingLink>
          aria-label="Meeting links"
          columns={columns}
          data={links}
          getRowId={(row) => row.id}
          {...gridStates(linksQuery, links.length, "meeting links", { title: "No meeting links yet", description: "A meeting link is a page you share so customers can book time with you, showing only the hours you are free." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()} className="flex items-center gap-1">
              <IconButton aria-label={`Copy booking link for ${row.name}`} size="compact" variant="outline" onPress={() => copyBookingLink(row)}>
                <Copy className="size-4" aria-hidden="true" />
              </IconButton>
              {copiedId === row.id && <span className="text-xs text-success">Copied</span>}
              <a aria-label={`Preview the booking page for ${row.name}`} href={`/book/${row.publicToken}`} target="_blank" rel="noreferrer" className="inline-flex h-[var(--control-height-compact)] items-center rounded-[var(--radius-control)] border border-border-strong px-2 text-xs font-medium text-text hover:bg-surface-muted">Preview</a>
              {row.status === "active" && <MoreMenu label={`More actions for ${row.name}`} isBusy={archiveMutation.isPending} items={[{ id: "archive", label: "Turn off this link", danger: true, onAction: () => archiveMutation.mutate(row), confirm: { title: `Turn off ${row.name}?`, description: "Guests who open the link will see that it is unavailable. Meetings already booked are not affected.", confirmLabel: "Turn off" } }]} />}
            </span>
          )}
        />
      </EnterpriseListPage>

      <MeetingLinkDialog isOpen={dialogOpen} onOpenChange={setDialogOpen} onCreated={invalidate} onError={handleError} userOptions={userOptions} defaultOwnerUserId={workspace.userId} />
    </div>
  );
}

function MeetingLinkDialog({
  isOpen,
  onOpenChange,
  onCreated,
  onError,
  userOptions,
  defaultOwnerUserId,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (error: unknown) => void;
  userOptions: SelectOption[];
  defaultOwnerUserId: string;
}) {
  const [name, setName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState(defaultOwnerUserId);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [bufferBeforeMinutes, setBufferBeforeMinutes] = useState(0);
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState(0);
  const [timezone, setTimezone] = useState("UTC");
  const [meetingProvider, setMeetingProvider] = useState("manual");
  const [locationTemplate, setLocationTemplate] = useState("");
  const [availability, setAvailability] = useState<MeetingLinkAvailability>({
    monday: [{ start: "09:00", end: "17:00" }],
    tuesday: [{ start: "09:00", end: "17:00" }],
    wednesday: [{ start: "09:00", end: "17:00" }],
    thursday: [{ start: "09:00", end: "17:00" }],
    friday: [{ start: "09:00", end: "17:00" }],
  });

  function toggleDay(day: keyof MeetingLinkAvailability, enabled: boolean) {
    setAvailability((current) => {
      const next = { ...current };
      if (enabled) next[day] = [{ start: "09:00", end: "17:00" }];
      else delete next[day];
      return next;
    });
  }
  function setWindow(day: keyof MeetingLinkAvailability, field: "start" | "end", value: string) {
    setAvailability((current) => ({
      ...current,
      [day]: [{ ...(current[day]?.[0] || { start: "09:00", end: "17:00" }), [field]: value }],
    }));
  }

  const mutation = useMutation({
    mutationFn: () =>
      createMeetingLink({
        name,
        ownerUserId,
        durationMinutes,
        bufferBeforeMinutes,
        bufferAfterMinutes,
        timezone,
        availability,
        meetingProvider,
        locationTemplate: locationTemplate || null,
      }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setName("");
      setLocationTemplate("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New meeting link">
      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
        <TextField label="Name" isRequired value={name} onChange={setName} />
        <Select label="Owner" options={userOptions} selectedKey={ownerUserId} onSelectionChange={(key) => setOwnerUserId(String(key ?? ownerUserId))} />
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Duration (min)" minValue={5} maxValue={480} value={durationMinutes} onChange={setDurationMinutes} />
          <NumberField label="Buffer before (min)" minValue={0} maxValue={120} value={bufferBeforeMinutes} onChange={setBufferBeforeMinutes} />
          <NumberField label="Buffer after (min)" minValue={0} maxValue={120} value={bufferAfterMinutes} onChange={setBufferAfterMinutes} />
        </div>
        <TextField label="Timezone (IANA, display only)" description="e.g. Asia/Kolkata — shown to guests; availability windows below are in UTC." value={timezone} onChange={setTimezone} />
        <Select label="Meeting provider" options={PROVIDER_OPTIONS} selectedKey={meetingProvider} onSelectionChange={(key) => setMeetingProvider(String(key ?? "manual"))} />
        <TextField label="Location / URL template" description="Shown as the meeting location, or auto-detected as online if it's a URL." value={locationTemplate} onChange={setLocationTemplate} />

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-text-muted">Weekly availability (UTC)</p>
          {WEEKDAYS.map(({ key, label }) => {
            const enabled = Boolean(availability[key]?.length);
            const window = availability[key]?.[0];
            return (
              <div key={key} className="flex items-center gap-2">
                <label className="flex w-16 items-center gap-1.5 text-sm text-text">
                  <input type="checkbox" checked={enabled} onChange={(event) => toggleDay(key, event.target.checked)} />
                  {label}
                </label>
                {enabled && (
                  <>
                    <input
                      type="time"
                      value={window?.start || "09:00"}
                      onChange={(event) => setWindow(key, "start", event.target.value)}
                      className="rounded-[var(--radius-control)] border border-border bg-canvas px-2 py-1 text-sm text-text"
                    />
                    <span className="text-text-muted">–</span>
                    <input
                      type="time"
                      value={window?.end || "17:00"}
                      onChange={(event) => setWindow(key, "end", event.target.value)}
                      className="rounded-[var(--radius-control)] border border-border bg-canvas px-2 py-1 text-sm text-text"
                    />
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!name.trim() || !ownerUserId}>
            Create meeting link
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
