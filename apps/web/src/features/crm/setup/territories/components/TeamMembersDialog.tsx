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
} from "../api/territories-api";
import type { SalesTeam, SalesTeamMember } from "../types";
import { dateFormatter } from "./sales-organization-format";

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
  const [memberRole, setMemberRole] = useState("");
  const [allocationPercent, setAllocationPercent] = useState("100");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");

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
        memberRole: memberRole || null,
        allocationPercent: allocationPercent ? Number(allocationPercent) : null,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
      }),
    onSuccess: () => {
      invalidate();
      setUserId("");
      setMemberRole("");
      setAllocationPercent("100");
      setEffectiveFrom("");
      setEffectiveTo("");
    },
    onError,
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
                  {member.memberRole || "Member"} ·{" "}
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
          <Select
            label="Add member"
            options={userOptions}
            selectedKey={userId}
            onSelectionChange={(key) => setUserId(String(key ?? ""))}
          />
          <TextField
            label="Role"
            placeholder="e.g. rep, lead"
            value={memberRole}
            onChange={setMemberRole}
          />
          <TextField
            label="Allocation %"
            value={allocationPercent}
            onChange={setAllocationPercent}
          />
          <div className="flex gap-3">
            <TextField
              label="Effective from"
              placeholder="YYYY-MM-DD"
              value={effectiveFrom}
              onChange={setEffectiveFrom}
            />
            <TextField
              label="Effective to"
              placeholder="YYYY-MM-DD"
              value={effectiveTo}
              onChange={setEffectiveTo}
            />
          </div>
          <Button
            variant="secondary"
            size="compact"
            className="self-start"
            onPress={() => addMutation.mutate()}
            isLoading={addMutation.isPending}
            isDisabled={!userId}
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
