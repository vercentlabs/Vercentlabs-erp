"use client";

import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  PermissionState,
  Select,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { formatDate, humanize } from "@/features/crm/shared/human";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { getCrmOptions } from "@/features/crm/shared/crm-options-api";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  createPrivacyRequest,
  executePrivacyRequest,
  getPrivacyRetentionDashboard,
  listPrivacyRequests,
  previewPrivacyRequest,
  PrivacyApiError,
  runPrivacyRetentionNow,
  updatePrivacyRetentionPolicy,
} from "../api/privacy-requests-api";
import { PRIVACY_REQUEST_TYPES, type PrivacyRequest, type PrivacyRequestPreview } from "../types";

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  received: "neutral",
  verification_pending: "info",
  in_progress: "warning",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
};

const REQUEST_TYPE_OPTIONS: SelectOption[] = PRIVACY_REQUEST_TYPES.map((value) => ({ value, label: humanize(value) }));
const SUBJECT_TYPE_OPTIONS: SelectOption[] = [
  { value: "lead", label: "Lead" },
  { value: "contact", label: "Contact" },
  { value: "party", label: "Account" },
];
const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "all", label: "All statuses" },
  { value: "received", label: "Received" },
  { value: "verification_pending", label: "Verification pending" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

function defaultDueDate(): string {
  const due = new Date();
  due.setDate(due.getDate() + 30);
  return due.toISOString().slice(0, 10);
}

// F001-adjacent (Leads gap-closure) — wires up account-intelligence.js's
// already-built preview/executePrivacyRequest engine and the
// crm_privacy_requests/crm_privacy_retention_policies tables, which had a
// full backend but no route and no screen before this. Distinct from the
// platform-wide Privacy Administration screen at /crm/settings/privacy
// (services/api/src/core/privacy.js): that one is a generic subject-
// reference tracker; this one understands Lead/Contact/Account subjects
// specifically and drives the same governed anonymize/erase/restrict/
// export operations those records already support elsewhere in CRM.
export function PrivacyRequestsSettingsScreen() {
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CRM_PERMISSIONS.privacyManage);
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailRequest, setDetailRequest] = useState<PrivacyRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Subjects are shown by name (leads, contacts and accounts the viewer can see).
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const subjectNames = useMemo(() => {
    const options = optionsQuery.data?.options;
    const pairs = [...(options?.leads ?? []), ...(options?.contacts ?? []), ...(options?.parties ?? [])].map((row) => [String(row.id), String(row.name ?? row.fullName ?? "")] as const);
    return new Map(pairs.filter(([, name]) => name));
  }, [optionsQuery.data]);
  const requestsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "privacy-requests", statusFilter),
    queryFn: () => listPrivacyRequests(statusFilter),
    enabled: canManage,
  });
  const retentionQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "privacy-retention"),
    queryFn: getPrivacyRetentionDashboard,
    enabled: canManage,
  });

  function invalidateRequests() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "privacy-requests") });
  }
  function invalidateRetention() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "privacy-retention") });
  }
  function handleError(err: unknown) {
    setError(err instanceof PrivacyApiError ? err.message : "This action could not be completed.");
  }

  const runRetentionMutation = useMutation({
    mutationFn: runPrivacyRetentionNow,
    onSuccess: invalidateRetention,
    onError: handleError,
  });

  if (!canManage)
    return <PermissionState title="You don't have access to Data Subject Requests" description="Ask an administrator to grant crm.privacy.manage." />;

  const requests = requestsQuery.data?.rows ?? [];
  const dashboard = retentionQuery.data?.dashboard;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">Data subject requests</h1>
          <p className="text-sm text-text-secondary">Track and fulfil access, correction, deletion and consent-withdrawal requests for Leads, Contacts and Accounts.</p>
        </div>
        <Button variant="primary" onPress={() => setCreateOpen(true)}>New request</Button>
      </div>

      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Tabs>
        <TabList aria-label="Privacy sections">
          <Tab id="requests">Requests</Tab>
          <Tab id="retention">Retention</Tab>
        </TabList>

        <TabPanel id="requests">
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-secondary">Only the operations the record&rsquo;s current state allows are offered — a legal hold or unverified identity blocks execution.</p>
              <Select label="Status" options={STATUS_FILTER_OPTIONS} selectedKey={statusFilter} onSelectionChange={(key) => setStatusFilter(String(key ?? "all"))} />
            </div>
            {requestsQuery.isLoading && <LoadingState label="Loading requests" rows={3} onRetry={() => requestsQuery.refetch()} />}
            {requestsQuery.isError && (
              <p role="alert" className="text-sm text-danger">The requests could not be loaded. <button type="button" className="underline" onClick={() => requestsQuery.refetch()}>Try again</button></p>
            )}
            {requestsQuery.isSuccess && requests.length === 0 && (
              <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">No requests recorded yet. When a Lead, Contact or Account owner asks to see, correct, export, restrict or delete their data, record it here so it is tracked to completion.</p>
            )}
            <ul className="flex flex-col gap-2">
              {requests.map((row) => (
                <li key={row.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text">
                      {humanize(row.requestType)} <span className="font-normal text-text-secondary">{`for ${humanize(row.subjectType).toLowerCase()} ${subjectNames.get(row.subjectId) ?? "(no longer in your list)"}`}</span>
                    </span>
                    <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{humanize(row.status)}</StatusBadge>
                  </div>
                  <span className="text-xs text-text-muted">{`Requested by ${row.requesterName || row.requesterEmail || "unspecified"} · Due ${formatDate(row.dueAt)}`}</span>
                  {!["completed", "rejected", "cancelled"].includes(row.status) && (
                    <Button variant="secondary" size="compact" className="self-start" onPress={() => setDetailRequest(row)}>
                      Review
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </TabPanel>

        <TabPanel id="retention">
          <div className="flex flex-col gap-3 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-text-secondary">Leads/Contacts/Accounts past their retention window are anonymized or restricted automatically; this also runs on a schedule.</p>
              <Button variant="secondary" size="compact" onPress={() => runRetentionMutation.mutate()} isLoading={runRetentionMutation.isPending}>
                Run retention now
              </Button>
            </div>
            {retentionQuery.isLoading && <LoadingState label="Loading retention policies" rows={2} onRetry={() => retentionQuery.refetch()} />}
            {dashboard && (
              <>
                <dl className="grid grid-cols-3 gap-3">
                  <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><dt className="text-xs text-text-muted">Active policies</dt><dd className="text-2xl font-semibold tabular-nums text-text">{dashboard.metrics.activePolicies}</dd></div>
                  <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><dt className="text-xs text-text-muted">Completed runs</dt><dd className="text-2xl font-semibold tabular-nums text-text">{dashboard.metrics.completedRuns}</dd></div>
                  <div className="rounded-[var(--radius-card)] border border-border bg-surface p-3"><dt className="text-xs text-text-muted">Failed runs</dt><dd className="text-2xl font-semibold tabular-nums text-text">{dashboard.metrics.failedRuns}</dd></div>
                </dl>
                {dashboard.policies.length === 0 ? (
                  <p className="rounded-[var(--radius-control)] bg-canvas-strong px-4 py-6 text-sm text-text-secondary">No retention policies yet. A policy says how long a kind of record is kept and what happens after that (anonymise or delete).</p>
                ) : (
                <div className="overflow-x-auto rounded-[var(--radius-control)] border border-border">
                  <Table className="w-full text-sm">
                    <TableHead className="bg-canvas-strong text-left text-xs uppercase tracking-wide text-text-muted">
                      <TableRow>
                        <TableHeaderCell className="px-3 py-2">Subject</TableHeaderCell>
                        <TableHeaderCell className="px-3 py-2">Policy</TableHeaderCell>
                        <TableHeaderCell className="px-3 py-2">Kept for</TableHeaderCell>
                        <TableHeaderCell className="px-3 py-2">Action</TableHeaderCell>
                        <TableHeaderCell className="px-3 py-2">Status</TableHeaderCell>
                        <TableHeaderCell className="px-3 py-2" />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {dashboard.policies.map((policy) => (
                        <RetentionPolicyRow key={policy.id} policy={policy} onSaved={invalidateRetention} onError={handleError} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
                )}
              </>
            )}
          </div>
        </TabPanel>
      </Tabs>

      <CreateRequestDialog isOpen={createOpen} onOpenChange={setCreateOpen} onCreated={invalidateRequests} onError={handleError} />
      <RequestDetailDialog request={detailRequest} onOpenChange={(open) => !open && setDetailRequest(null)} onExecuted={invalidateRequests} onError={handleError} />
    </div>
  );
}

function RetentionPolicyRow({
  policy,
  onSaved,
  onError,
}: {
  policy: { id: string; subject_type: string; name: string; retention_days: number; action: string; status: string };
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const mutation = useMutation({
    mutationFn: (input: Record<string, unknown>) => updatePrivacyRetentionPolicy(policy.id, input),
    onSuccess: onSaved,
    onError,
  });
  return (
    <TableRow className="border-t border-border">
      <TableCell className="px-3 py-2 font-medium text-text">{humanize(policy.subject_type)}</TableCell>
      <TableCell className="px-3 py-2">{policy.name}</TableCell>
      <TableCell className="px-3 py-2">{`${policy.retention_days.toLocaleString("en-IN")} days`}</TableCell>
      <TableCell className="px-3 py-2">{humanize(policy.action)}</TableCell>
      <TableCell className="px-3 py-2"><StatusBadge tone={policy.status === "active" ? "success" : "neutral"}>{policy.status}</StatusBadge></TableCell>
      <TableCell className="px-3 py-2">
        <Button
          variant="ghost"
          size="compact"
          isLoading={mutation.isPending}
          onPress={() => mutation.mutate({ status: policy.status === "active" ? "inactive" : "active" })}
        >
          {policy.status === "active" ? "Deactivate" : "Activate"}
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CreateRequestDialog({ isOpen, onOpenChange, onCreated, onError }: { isOpen: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void; onError: (error: unknown) => void }) {
  const [requestType, setRequestType] = useState("access");
  const [subjectType, setSubjectType] = useState("lead");
  const [subjectId, setSubjectId] = useState("");
  const [requesterName, setRequesterName] = useState("");
  const [requesterEmail, setRequesterEmail] = useState("");
  const [dueAt, setDueAt] = useState(defaultDueDate());

  const mutation = useMutation({
    mutationFn: () => createPrivacyRequest({ requestType, subjectType, subjectId, requesterName, requesterEmail, dueAt }),
    onSuccess: () => {
      onCreated();
      onOpenChange(false);
      setSubjectId("");
      setRequesterName("");
      setRequesterEmail("");
    },
    onError,
  });

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} title="New data subject request">
      <div className="flex flex-col gap-4">
        <Select label="Request type" options={REQUEST_TYPE_OPTIONS} selectedKey={requestType} onSelectionChange={(key) => setRequestType(String(key ?? "access"))} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Subject type" options={SUBJECT_TYPE_OPTIONS} selectedKey={subjectType} onSelectionChange={(key) => setSubjectType(String(key ?? "lead"))} />
          <TextField label="Subject ID" isRequired value={subjectId} onChange={setSubjectId} />
        </div>
        <TextField label="Requester name" value={requesterName} onChange={setRequesterName} />
        <TextField label="Requester email" value={requesterEmail} onChange={setRequesterEmail} />
        <TextField label="Due date" type="date" value={dueAt} onChange={setDueAt} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!subjectId.trim()}>
            Create request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function RequestDetailDialog({
  request,
  onOpenChange,
  onExecuted,
  onError,
}: {
  request: PrivacyRequest | null;
  onOpenChange: (open: boolean) => void;
  onExecuted: () => void;
  onError: (error: unknown) => void;
}) {
  const [erasureMode, setErasureMode] = useState("anonymize");
  const [corrections, setCorrections] = useState("{}");
  const [resolutionNotes, setResolutionNotes] = useState("");

  const previewQuery = useQuery({
    queryKey: ["crm-privacy-request-preview", request?.id],
    queryFn: () => previewPrivacyRequest(request!.id),
    enabled: Boolean(request),
  });

  const executeMutation = useMutation({
    mutationFn: () => {
      const input: Record<string, unknown> = { resolutionNotes };
      if (request?.requestType === "deletion") input.erasureMode = erasureMode;
      if (request?.requestType === "correction") {
        try {
          input.corrections = JSON.parse(corrections);
        } catch {
          throw new PrivacyApiError("Corrections must be valid JSON, e.g. {\"companyName\": \"Acme Inc\"}.", 400);
        }
      }
      return executePrivacyRequest(request!.id, input);
    },
    onSuccess: () => {
      onExecuted();
      onOpenChange(false);
      setResolutionNotes("");
    },
    onError,
  });

  const preview: PrivacyRequestPreview | undefined = previewQuery.data?.preview;

  return (
    <Dialog isOpen={Boolean(request)} onOpenChange={onOpenChange} title={request ? `Review ${humanize(request.requestType)} request` : "Review request"}>
      <div className="flex flex-col gap-4">
        {previewQuery.isLoading && <p className="text-sm text-text-muted">Checking readiness…</p>}
        {preview && (
          <div className="flex flex-col gap-2">
            <StatusBadge tone={preview.ready ? "success" : "warning"}>{preview.ready ? "Ready to execute" : "Not ready"}</StatusBadge>
            {preview.blockers.length > 0 && (
              <ul className="list-disc pl-5 text-sm text-danger">
                {preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            )}
            <dl className="grid grid-cols-2 gap-2 text-xs text-text-secondary sm:grid-cols-3">
              {Object.entries(preview.counts || {}).map(([key, value]) => (
                <div key={key}><dt className="text-text-muted">{humanize(key)}</dt><dd className="tabular-nums text-text">{value}</dd></div>
              ))}
            </dl>
          </div>
        )}
        {request?.requestType === "deletion" && (
          <Select
            label="Deletion mode"
            options={[{ value: "anonymize", label: "Anonymize (keeps a redacted record)" }, { value: "erase", label: "Erase (removes personal fields entirely)" }]}
            selectedKey={erasureMode}
            onSelectionChange={(key) => setErasureMode(String(key ?? "anonymize"))}
          />
        )}
        {request?.requestType === "correction" && (
          <TextArea label="Corrections (JSON)" description={'e.g. {"companyName": "Acme Inc", "email": "new@acme.com"}'} value={corrections} onChange={setCorrections} />
        )}
        <TextArea label="Resolution notes" value={resolutionNotes} onChange={setResolutionNotes} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Close</Button>
          <Button variant="primary" onPress={() => executeMutation.mutate()} isLoading={executeMutation.isPending} isDisabled={!preview?.ready}>
            Execute
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
