"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import {
  Button,
  Dialog,
  IconButton,
  Select,
  StatusBadge,
  TextField,
  type SelectOption,
} from "@vercentlabs/design-system";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  archiveSalesTeamMember,
  createSalesTeamMember,
  listSalesTeamMembers,
} from "../api/teams-api";
import type { SalesTeam, SalesTeamMember } from "../types";
const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" });

// The roles lead assignment and analytics rely on (a seller is assigned leads; a manager sees the team's records). The server accepts only these.
const ROLE_OPTIONS: SelectOption[] = [
  { value: "seller", label: "Seller" },
  { value: "manager", label: "Manager" },
  { value: "sales_ops", label: "Sales operations" },
  { value: "overlay", label: "Overlay (specialist)" },
  { value: "observer", label: "Observer" },
];
const roleLabel = (role: string | null) => ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role ?? "Seller";
const today = () => new Date().toISOString().slice(0, 10);
// The message and per-field problems the server returns, shown in the dialog itself.
function problemsOf(error: unknown): { message: string; fields: Record<string, string> } {
  const details = (error as { details?: { errors?: Record<string, string[]> } })?.details;
  const fields = Object.fromEntries(Object.entries(details?.errors ?? {}).map(([field, messages]) => [field, messages[0]]));
  return { message: error instanceof Error && error.message ? error.message : "The member could not be added. Try again.", fields };
}

export function TeamMembersDialog({
  team,
  onOpenChange,
  userOptions,
  onError,
}: {
  team: SalesTeam | null;
  onOpenChange: (open: boolean) => void;
  userOptions: SelectOption[];
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [userId, setUserId] = useState("");
  const [memberRole, setMemberRole] = useState("seller");
  const [allocationPercent, setAllocationPercent] = useState("100");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [effectiveTo, setEffectiveTo] = useState("");
  const [problem, setProblem] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const allocation = Number(allocationPercent);
  const allocationValid = allocationPercent.trim() !== "" && Number.isFinite(allocation) && allocation > 0 && allocation <= 100;
  const datesValid = !effectiveTo || !effectiveFrom || effectiveTo >= effectiveFrom;

  const membersQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "sales-team-members",
      team?.id ?? "",
    ),
    queryFn: () => listSalesTeamMembers(team!.id),
    enabled: Boolean(team),
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(
        workspace,
        "crm",
        "sales-team-members",
        team?.id ?? "",
      ),
    });
  }

  const addMutation = useMutation({
    mutationFn: () =>
      createSalesTeamMember({
        teamId: team!.id,
        userId,
        memberRole,
        allocationPercent: allocation,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
      }),
    onSuccess: () => {
      invalidate();
      setUserId("");
      setMemberRole("seller");
      setAllocationPercent("100");
      setEffectiveFrom(today());
      setEffectiveTo("");
      setProblem(null);
    },
    onError: (error) => setProblem(problemsOf(error)),
  });
  const endMutation = useMutation({
    mutationFn: (member: SalesTeamMember) =>
      archiveSalesTeamMember(member.id, member.updatedAt),
    onSuccess: invalidate,
    onError,
  });

  const members = membersQuery.data?.rows ?? [];

  return (
    <Dialog
      isOpen={Boolean(team)}
      onOpenChange={onOpenChange}
      title={team ? `Members of ${team.name}` : "Members"}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {membersQuery.isLoading && (
            <p className="text-sm text-text-secondary">Loading members…</p>
          )}
          {!membersQuery.isLoading && members.length === 0 && (
            <p className="text-sm text-text-muted">No members yet.</p>
          )}
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2"
            >
              <div className="flex flex-col text-sm">
                <span className="font-medium text-text">
                  {userOptions.find((option) => option.value === member.userId)
                    ?.label ?? member.userId}
                </span>
                <span className="text-text-secondary">
                  {roleLabel(member.memberRole)} ·{" "}
                  {member.allocationPercent ?? 100}%
                  {member.effectiveFrom
                    ? ` · from ${dateFormatter.format(new Date(member.effectiveFrom))}`
                    : ""}
                  {member.effectiveTo
                    ? ` · to ${dateFormatter.format(new Date(member.effectiveTo))}`
                    : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge
                  tone={member.status === "active" ? "success" : "neutral"}
                >
                  {member.status}
                </StatusBadge>
                {member.status === "active" && (
                  <IconButton
                    aria-label="End membership"
                    size="compact"
                    variant="danger"
                    onPress={() => endMutation.mutate(member)}
                  >
                    <Archive className="size-4" aria-hidden="true" />
                  </IconButton>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3 border-t border-border-strong pt-4">
          {problem && (
            <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{problem.message}</p>
          )}
          <Select
            label="Add member"
            options={userOptions}
            selectedKey={userId}
            onSelectionChange={(key) => { setUserId(String(key ?? "")); setProblem(null); }}
            errorMessage={problem?.fields.userId}
          />
          <Select
            label="Role"
            options={ROLE_OPTIONS}
            selectedKey={memberRole}
            onSelectionChange={(key) => setMemberRole(String(key ?? "seller"))}
            description="Sellers receive leads by round robin and team queues; managers see the team's records."
            errorMessage={problem?.fields.memberRole}
          />
          <TextField
            label="Allocation %"
            value={allocationPercent}
            onChange={setAllocationPercent}
            inputMode="decimal"
            description="Share of this person's time on the team (above 0, up to 100)."
            errorMessage={!allocationValid && allocationPercent !== "" ? "Enter a percentage above 0 and up to 100." : problem?.fields.allocationPercent}
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Effective from"
              type="date"
              value={effectiveFrom}
              onChange={setEffectiveFrom}
              errorMessage={problem?.fields.effectiveFrom}
            />
            <TextField
              label="Effective to (optional)"
              type="date"
              value={effectiveTo}
              onChange={setEffectiveTo}
              errorMessage={!datesValid ? "The end date cannot be before the start date." : problem?.fields.effectiveTo}
            />
          </div>
          <Button
            variant="secondary"
            size="compact"
            className="self-start"
            onPress={() => addMutation.mutate()}
            isLoading={addMutation.isPending}
            isDisabled={!userId || !allocationValid || !datesValid}
          >
            Add member
          </Button>
        </div>
        <div className="flex justify-end">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
