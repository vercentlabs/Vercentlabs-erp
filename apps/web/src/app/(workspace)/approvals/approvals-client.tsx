"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, Check, X } from "lucide-react";
import { Button, TextField } from "@vercentlabs/design-system";

type Approval = {
  id: string;
  entity_type: string;
  entity_id: string;
  title: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
  command_key: string;
};

const STATUS_TABS = ["pending", "approved", "rejected", "all"] as const;

async function fetchApprovals(status: string): Promise<Approval[]> {
  const response = await fetch(`/api/approvals?status=${status}`);
  const payload = (await response.json()) as {
    ok: boolean;
    approvals?: Approval[];
    message?: string;
  };
  if (!response.ok || !payload.ok)
    throw new Error(payload.message || "Could not load approvals.");
  return payload.approvals ?? [];
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

function ApprovalRow({
  approval,
  onDecided,
}: {
  approval: Approval;
  onDecided: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: "approved" | "rejected") => {
      const response = await fetch(`/api/approvals/${approval.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        message?: string;
      };
      if (!response.ok || !payload.ok)
        throw new Error(payload.message || "Could not record the decision.");
      return payload;
    },
    onSuccess: onDecided,
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text">{approval.title}</p>
          <p className="text-xs text-text-muted">
            {approval.entity_type} · requested{" "}
            {dateFormatter.format(new Date(approval.requested_at))}
          </p>
        </div>
        <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium capitalize text-text-secondary">
          {approval.status}
        </span>
      </div>
      {approval.status === "pending" ? (
        <div className="flex flex-wrap items-center gap-2">
          <TextField
            label="Note"
            aria-label="Decision note"
            placeholder="Optional note (required to reject)"
            value={note}
            onChange={setNote}
            size="compact"
            className="min-w-[220px] flex-1"
          />
          <Button
            variant="primary"
            size="compact"
            onPress={() => decide.mutate("approved")}
            isLoading={decide.isPending}
          >
            <Check aria-hidden="true" className="size-4" />
            Approve
          </Button>
          <Button
            variant="danger"
            size="compact"
            onPress={() => decide.mutate("rejected")}
            isLoading={decide.isPending}
          >
            <X aria-hidden="true" className="size-4" />
            Reject
          </Button>
        </div>
      ) : approval.decision_note ? (
        <p className="text-xs text-text-secondary">
          Note: {approval.decision_note}
        </p>
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </li>
  );
}

export function ApprovalsClient() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]>("pending");
  const query = useQuery({
    queryKey: ["approvals", status],
    queryFn: () => fetchApprovals(status),
  });

  function refetchAll() {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <h1 className="text-xl font-semibold text-text">Approvals</h1>

      <div className="flex gap-1 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setStatus(tab)}
            className={[
              "border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors",
              status === tab
                ? "border-brand text-brand"
                : "border-transparent text-text-secondary hover:text-text",
            ].join(" ")}
          >
            {tab}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading approvals…</p>
      ) : query.isError ? (
        <p className="text-sm text-danger">
          Could not load approvals. Try again.
        </p>
      ) : (query.data ?? []).length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <CheckSquare aria-hidden="true" className="size-8 text-text-muted" />
          <p className="text-sm text-text-secondary">Nothing here.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-panel)] border border-border">
          {(query.data ?? []).map((approval) => (
            <ApprovalRow
              key={approval.id}
              approval={approval}
              onDecided={refetchAll}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
