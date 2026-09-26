"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog, Button, Dialog, EmptyState, ErrorState, PageHeader, StatusBadge, Tab, TabList, Tabs, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

// Row shape returned by GET /api/approvals. Capabilities come from the server;
// this screen never infers who may approve.
type Approval = {
  id: string;
  label: string;
  moduleLabel: string | null;
  documentLabel: string;
  requestedByName: string | null;
  assignedToName: string | null;
  decidedByName: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  version: number;
  isMine: boolean;
  href: string | null;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
};

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STATUS: Record<Approval["status"], { label: string; tone: "warning" | "success" | "danger" | "neutral" }> = {
  pending: { label: "Pending", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const formatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload as T;
}

type Decision = { approval: Approval; decision: "approved" | "rejected" | "cancelled" };

export function ApprovalsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("pending");
  const [pending, setPending] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "approvals", tab),
    queryFn: () => send<{ approvals: Approval[] }>(`/api/approvals?status=${tab}`).then((r) => r.approvals),
  });

  const decide = useMutation({
    mutationFn: ({ approval, decision }: Decision) =>
      send(`/api/approvals/${approval.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note.trim() || null, expectedVersion: approval.version }),
      }),
    onSuccess: (_result, { decision }) => {
      setPending(null);
      setNote("");
      setMessage({ tone: "success", text: decision === "approved" ? "Approved." : decision === "rejected" ? "Rejected." : "Request cancelled." });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "approvals") });
    },
    onError: (error) => {
      setPending(null);
      setMessage({ tone: "danger", text: error instanceof Error ? error.message : "The decision could not be recorded." });
    },
  });

  const rows = query.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Approvals" description="Requests waiting for you, requests you raised, and their history." />
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as TabKey)}>
        <TabList aria-label="Approval status" className="overflow-x-auto">
          {TABS.map((entry) => (
            <Tab key={entry.key} id={entry.key}>
              {entry.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      {message && (
        <p role={message.tone === "danger" ? "alert" : "status"} className={`text-sm ${message.tone === "danger" ? "text-danger" : "text-success"}`}>
          {message.text}
        </p>
      )}
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading approvals…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load approvals" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing here" description={tab === "pending" ? "No approvals are waiting for you." : "No approvals in this view."} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface" aria-label="Approvals">
          {rows.map((approval) => (
            <li key={approval.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text">{approval.label}</span>
                  <StatusBadge tone={STATUS[approval.status].tone}>{STATUS[approval.status].label}</StatusBadge>
                </div>
                {approval.href ? (
                  <Link href={approval.href} className="text-sm text-brand hover:underline">
                    {approval.documentLabel}
                  </Link>
                ) : (
                  <span className="text-sm text-text">{approval.documentLabel}</span>
                )}
                <dl className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-0.5 text-xs text-text-secondary">
                  {approval.moduleLabel && (
                    <>
                      <dt className="text-text-muted">Module</dt>
                      <dd>{approval.moduleLabel}</dd>
                    </>
                  )}
                  <dt className="text-text-muted">Requested by</dt>
                  <dd>{approval.isMine ? "You" : approval.requestedByName ?? "—"}</dd>
                  <dt className="text-text-muted">Assigned to</dt>
                  <dd>{approval.assignedToName ?? "Any approver"}</dd>
                  <dt className="text-text-muted">Requested</dt>
                  <dd>{formatter.format(new Date(approval.requestedAt))}</dd>
                  {approval.decidedAt && (
                    <>
                      <dt className="text-text-muted">Decided</dt>
                      <dd>{`${formatter.format(new Date(approval.decidedAt))}${approval.decidedByName ? ` by ${approval.decidedByName}` : ""}`}</dd>
                    </>
                  )}
                  {approval.decisionNote && (
                    <>
                      <dt className="text-text-muted">Note</dt>
                      <dd>{approval.decisionNote}</dd>
                    </>
                  )}
                </dl>
              </div>
              {(approval.canApprove || approval.canReject || approval.canCancel) && (
                <div className="flex flex-wrap gap-2 md:shrink-0">
                  {approval.canApprove && (
                    <Button variant="primary" size="compact" onPress={() => setPending({ approval, decision: "approved" })}>
                      Approve
                    </Button>
                  )}
                  {approval.canReject && (
                    <Button variant="danger" size="compact" onPress={() => setPending({ approval, decision: "rejected" })}>
                      Reject
                    </Button>
                  )}
                  {approval.canCancel && (
                    <Button variant="secondary" size="compact" onPress={() => setPending({ approval, decision: "cancelled" })}>
                      Cancel request
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog
        isOpen={pending?.decision === "approved"}
        onOpenChange={(open) => !open && setPending(null)}
        title="Approve this request?"
        description={pending ? `${pending.approval.label}: ${pending.approval.documentLabel}` : ""}
        confirmLabel="Approve"
        isConfirming={decide.isPending}
        onConfirm={() => pending && decide.mutate(pending)}
      />
      <Dialog
        isOpen={pending?.decision === "rejected" || pending?.decision === "cancelled"}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.decision === "rejected" ? "Reject this request" : "Cancel this request"}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">
            {pending?.decision === "rejected"
              ? "Tell the requester why. A reason is required."
              : "Cancelling withdraws the request. The document itself is not changed."}
          </p>
          <TextArea label={pending?.decision === "rejected" ? "Reason" : "Note (optional)"} isRequired={pending?.decision === "rejected"} value={note} onChange={setNote} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setPending(null)}>
              Back
            </Button>
            <Button
              variant={pending?.decision === "rejected" ? "danger" : "primary"}
              isLoading={decide.isPending}
              isDisabled={pending?.decision === "rejected" && !note.trim()}
              onPress={() => pending && decide.mutate(pending)}
            >
              {pending?.decision === "rejected" ? "Reject" : "Cancel request"}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
