"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, NumberField, PageHeader, PermissionState, Select, StatusBadge, Tab, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, TabList, TabPanel, Tabs, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  createPrivacyRequest,
  listPrivacyRequests,
  listRetentionPolicies,
  PrivacyApiError,
  transitionPrivacyRequest,
  writeRetentionPolicy,
  type PrivacyDataClass,
  type PrivacyRequest,
} from "../api/privacy-api";

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const formatDate = (value: string) => dateFormatter.format(new Date(value));
const humanize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
const ENFORCEMENT: Record<string, { label: string; tone: "neutral" | "info" | "warning" }> = {
  review_required: { label: "Reviewed, not auto-deleted", tone: "neutral" },
  statutory_hold: { label: "Statutory record: never auto-deleted", tone: "warning" },
  automatic_expiry: { label: "Deleted automatically", tone: "info" },
};

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  received: "neutral",
  verified: "info",
  in_progress: "warning",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
};

// Mirrors PRIVACY_TRANSITIONS in services/api/src/core/platform/privacy
// exactly — this UI only ever offers a transition the server itself
// would accept, it does not decide legality independently.
const NEXT_STATUSES: Record<string, string[]> = {
  received: ["verified", "rejected", "cancelled"],
  verified: ["in_progress", "rejected", "cancelled"],
  in_progress: ["completed", "rejected", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

const REQUEST_TYPE_OPTIONS: SelectOption[] = [
  { value: "access", label: "Access" },
  { value: "export", label: "Export" },
  { value: "correction", label: "Correction" },
  { value: "restriction", label: "Restriction" },
  { value: "erasure", label: "Erasure" },
  { value: "consent_withdrawal", label: "Consent withdrawal" },
];


// Settings > Privacy and retention. Surfaces the shared platform privacy
// authority (core/platform/privacy): the request tracker and versioned
// retention policies for registered data classes. Gated by
// platform.privacy.manage, an elevated permission that ordinary module
// managers do not hold.
export function PrivacyAdministrationScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CORE_PERMISSIONS.platformPrivacyManage);
  const [createOpen, setCreateOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "privacy", "requests"), queryFn: listPrivacyRequests, enabled: canManage });
  const policiesQuery = useQuery({ queryKey: scopedQueryKey(workspace, "privacy", "retention-policies"), queryFn: listRetentionPolicies, enabled: canManage });
  const queryClient = useQueryClient();

  function invalidateRequests() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "privacy", "requests") });
  }
  function invalidatePolicies() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "privacy", "retention-policies") });
  }

  const transitionMutation = useMutation({
    mutationFn: ({ row, status }: { row: PrivacyRequest; status: string }) => transitionPrivacyRequest(row.id, status),
    onSuccess: () => {
      setError(null);
      invalidateRequests();
    },
    onError: (err: unknown) => setError(err instanceof PrivacyApiError ? err.message : "This request could not be updated."),
  });

  if (!canManage) return <PermissionState title="You don't have access to privacy and retention" description="Ask an administrator with the privacy management permission." />;

  const requests = requestsQuery.data?.rows ?? [];
  const policies = policiesQuery.data?.rows ?? [];
  const dataClasses = policiesQuery.data?.dataClasses ?? [];

  const open = requests.filter((r) => !["completed", "rejected", "cancelled"].includes(r.status));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Privacy and retention" description="Handle data requests from people, and set how long each kind of data is kept." />
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><dt className="text-xs text-text-muted">Open requests</dt><dd className="text-2xl font-semibold tabular-nums text-text">{requestsQuery.isLoading ? "…" : open.length}</dd></div>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><dt className="text-xs text-text-muted">Completed</dt><dd className="text-2xl font-semibold tabular-nums text-text">{requestsQuery.isLoading ? "…" : requests.filter((r) => r.status === "completed").length}</dd></div>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><dt className="text-xs text-text-muted">Retention policies</dt><dd className="text-2xl font-semibold tabular-nums text-text">{policiesQuery.isLoading ? "…" : policies.length}</dd></div>
      </dl>

      <Tabs>
        <TabList aria-label="Privacy sections">
          <Tab id="requests">Requests</Tab>
          <Tab id="retention">Retention</Tab>
        </TabList>

        <TabPanel id="requests">
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-secondary">Access, correction and erasure requests move through received, verified, in progress and completed. Only the next valid step is offered.</p>
              <Button variant="primary" size="compact" onPress={() => setCreateOpen(true)}>New request</Button>
            </div>
            {requestsQuery.isError ? (
              <p role="alert" className="text-sm text-danger">The requests could not be loaded. <button type="button" className="underline" onClick={() => requestsQuery.refetch()}>Try again</button></p>
            ) : requests.length === 0 ? (
              <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">No privacy requests have been recorded. When someone asks to see, correct or delete their data, record it here so it is tracked to completion.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {requests.map((row) => (
                  <li key={row.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text">{humanize(row.request_type)}<span className="font-normal text-text-secondary">{` for ${row.subject_reference}`}</span></span>
                      <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</StatusBadge>
                    </div>
                    <span className="text-xs text-text-muted">{`Requested ${formatDate(row.requested_at)}`}</span>
                    {(NEXT_STATUSES[row.status] ?? []).length > 0 && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-text-muted">Move to:</span>
                        {NEXT_STATUSES[row.status].map((next) => (
                          <Button key={next} variant={next === "rejected" || next === "cancelled" ? "secondary" : "primary"} size="compact" onPress={() => transitionMutation.mutate({ row, status: next })} isLoading={transitionMutation.isPending}>
                            {humanize(next)}
                          </Button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabPanel>

        <TabPanel id="retention">
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-secondary">How long each kind of data is kept. A change is a new version; older versions stay for the record.</p>
              <Button variant="secondary" size="compact" onPress={() => setPolicyOpen(true)}>New version</Button>
            </div>
            {policiesQuery.isError ? (
              <p role="alert" className="text-sm text-danger">The policies could not be loaded. <button type="button" className="underline" onClick={() => policiesQuery.refetch()}>Try again</button></p>
            ) : policies.length === 0 ? (
              <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">No retention policies are set. Add one per kind of data, for example how many days closed leads are kept.</p>
            ) : (
              <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
                <Table className="w-full text-sm">
                  <TableHead className="bg-canvas-strong text-left text-xs uppercase tracking-wide text-text-muted"><TableRow><TableHeaderCell className="px-3 py-2">Data</TableHeaderCell><TableHeaderCell className="px-3 py-2">Version</TableHeaderCell><TableHeaderCell className="px-3 py-2">Kept for</TableHeaderCell><TableHeaderCell className="px-3 py-2">In force</TableHeaderCell><TableHeaderCell className="px-3 py-2">Enforcement</TableHeaderCell></TableRow></TableHead>
                  <TableBody>
                    {policies.map((row) => (
                      <TableRow key={row.id} className="border-t border-border">
                        <TableCell className="px-3 py-2 font-medium text-text">{row.dataClassLabel}</TableCell>
                        <TableCell className="px-3 py-2">{`Version ${row.version}`}</TableCell>
                        <TableCell className="px-3 py-2">{`${row.retention_days.toLocaleString("en-IN")} days`}</TableCell>
                        <TableCell className="px-3 py-2 text-text-secondary">{`${formatDate(row.effective_from)} ${row.effective_to ? "to " + formatDate(row.effective_to) : "onwards"}`}</TableCell>
                        <TableCell className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <StatusBadge tone={ENFORCEMENT[row.enforcement]?.tone ?? "neutral"}>{ENFORCEMENT[row.enforcement]?.label ?? row.enforcement}</StatusBadge>
                            <span className="text-xs text-text-muted">{row.enforcementNote}</span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabPanel>
      </Tabs>

      <CreatePrivacyRequestDialog isOpen={createOpen} onOpenChange={setCreateOpen} onCreated={invalidateRequests} onError={setError} />
      <NewRetentionPolicyDialog dataClasses={dataClasses} isOpen={policyOpen} onOpenChange={setPolicyOpen} onCreated={invalidatePolicies} onError={setError} />
    </div>
  );
}

function CreatePrivacyRequestDialog({
  isOpen,
  onOpenChange,
  onCreated,
  onError,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [requestType, setRequestType] = useState("access");
  const [subjectReference, setSubjectReference] = useState("");

  const mutation = useMutation({
    mutationFn: () => createPrivacyRequest({ requestType, subjectReference }),
    onSuccess: () => {
      onOpenChange(false);
      setSubjectReference("");
      onCreated();
    },
    onError: (err: unknown) => onError(err instanceof PrivacyApiError ? err.message : "This request could not be created."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New privacy request">
      <div className="flex flex-col gap-4">
        <Select label="Request type" options={REQUEST_TYPE_OPTIONS} selectedKey={requestType} onSelectionChange={(key) => setRequestType(String(key ?? "access"))} />
        <TextField
          label="Subject reference"
          description="A stable reference to the subject record, e.g. account:<id> or contact:<id>."
          isRequired
          value={subjectReference}
          onChange={setSubjectReference}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!subjectReference.trim()}>
            Create request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function NewRetentionPolicyDialog({
  dataClasses,
  isOpen,
  onOpenChange,
  onCreated,
  onError,
}: {
  dataClasses: PrivacyDataClass[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [dataClass, setDataClass] = useState("");
  const [retentionDays, setRetentionDays] = useState(365);
  const selectedClass = dataClasses.find((entry) => entry.key === dataClass);
  const [legalBasis, setLegalBasis] = useState("");

  const mutation = useMutation({
    mutationFn: () => writeRetentionPolicy({ dataClass, retentionDays, legalBasis }),
    onSuccess: () => {
      onOpenChange(false);
      setDataClass("");
      setLegalBasis("");
      onCreated();
    },
    onError: (err: unknown) => onError(err instanceof PrivacyApiError ? err.message : "This retention policy could not be saved."),
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New retention policy version">
      <div className="flex flex-col gap-4">
        <Select
          label="Data class"
          isRequired
          options={dataClasses.map((entry) => ({ value: entry.key, label: entry.label }))}
          selectedKey={dataClass || null}
          onSelectionChange={(key) => setDataClass(String(key ?? ""))}
          description={selectedClass?.note}
        />
        <NumberField label="Keep for (days)" minValue={1} maxValue={36500} step={1} value={retentionDays} onChange={setRetentionDays} />
        <TextArea label="Legal basis" isRequired value={legalBasis} onChange={setLegalBasis} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!dataClass || !legalBasis.trim() || !Number.isInteger(retentionDays) || retentionDays < 1}>
            Save policy version
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
