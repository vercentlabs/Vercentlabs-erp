"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  PermissionState,
  Select,
  StatusBadge,
  TextArea,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
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
  type PrivacyRequest,
} from "../api/privacy-api";

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  received: "neutral",
  verified: "info",
  in_progress: "warning",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
};

// Mirrors PRIVACY_TRANSITIONS in services/api/src/core/privacy.js
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

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// F002 Stage A2 §13. Surfaces the shared PLATFORM privacy authority
// (core/privacy.js) — a real, already-built, org-scoped finite-state-
// machine request tracker and versioned retention-policy engine with
// zero frontend consumer anywhere in the app before this pass, not a
// CRM-local reimplementation. Gated by platform.privacy.manage, a
// genuinely elevated permission deliberately excluded from the default
// "privileged" role bundle — an ordinary CRM manager with
// crm.accounts.manage never sees this screen just by being able to
// manage Accounts.
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

  if (!canManage) return <PermissionState title="You don't have access to Privacy Administration" description="Ask an administrator to grant platform.privacy.manage." />;

  const requests = requestsQuery.data?.rows ?? [];
  const policies = policiesQuery.data?.rows ?? [];

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Privacy requests</h2>
          <Button variant="primary" size="compact" onPress={() => setCreateOpen(true)}>
            New request
          </Button>
        </div>
        {requests.length === 0 ? (
          <p className="text-sm text-text-muted">No privacy requests recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {requests.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-text">
                    {row.request_type} — {row.subject_reference}
                  </span>
                  <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</StatusBadge>
                </div>
                <span className="text-xs text-text-muted">Requested {dateFormatter.format(new Date(row.requested_at))}</span>
                {(NEXT_STATUSES[row.status] ?? []).length > 0 && (
                  <div className="flex gap-2">
                    {NEXT_STATUSES[row.status].map((next) => (
                      <Button
                        key={next}
                        variant={next === "rejected" || next === "cancelled" ? "danger" : "secondary"}
                        size="compact"
                        onPress={() => transitionMutation.mutate({ row, status: next })}
                        isLoading={transitionMutation.isPending}
                      >
                        {next.replace("_", " ")}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Retention policies</h2>
          <Button variant="secondary" size="compact" onPress={() => setPolicyOpen(true)}>
            New version
          </Button>
        </div>
        {policies.length === 0 ? (
          <p className="text-sm text-text-muted">No retention policies configured.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {policies.map((row) => (
              <li key={row.id} className="flex items-center justify-between rounded-[var(--radius-control)] border border-border px-3 py-2 text-sm">
                <span className="text-text">
                  {row.data_class} · v{row.version} · {row.retention_days} days
                </span>
                <span className="text-xs text-text-muted">
                  {row.effective_from.slice(0, 10)}
                  {row.effective_to ? ` – ${row.effective_to.slice(0, 10)}` : " – open-ended"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CreatePrivacyRequestDialog isOpen={createOpen} onOpenChange={setCreateOpen} onCreated={invalidateRequests} onError={setError} />
      <NewRetentionPolicyDialog isOpen={policyOpen} onOpenChange={setPolicyOpen} onCreated={invalidatePolicies} onError={setError} />
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
  const [dataClass, setDataClass] = useState("");
  const [retentionDays, setRetentionDays] = useState("365");
  const [legalBasis, setLegalBasis] = useState("");

  const mutation = useMutation({
    mutationFn: () => writeRetentionPolicy({ dataClass, retentionDays: Number(retentionDays) || 0, legalBasis }),
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
        <TextField label="Data class" description="e.g. crm.lead, crm.contact" isRequired value={dataClass} onChange={setDataClass} />
        <TextField label="Retention days" value={retentionDays} onChange={setRetentionDays} />
        <TextArea label="Legal basis" isRequired value={legalBasis} onChange={setLegalBasis} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!dataClass.trim() || !legalBasis.trim()}>
            Save policy version
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
