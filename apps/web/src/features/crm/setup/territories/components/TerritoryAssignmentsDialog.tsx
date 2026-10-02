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
  createTerritoryAssignment,
  endTerritoryAssignment,
  listTerritoryAssignments,
} from "../api/territories-api";
import type { Territory, TerritoryAssignment } from "../types";
import { dateFormatter } from "./sales-organization-format";

// F020 — the real, DB-enforced values (migration 003's
// assignment_role CHECK). Never free text: e.g. "Primary" (capitalized)
// would silently fall outside both the dashboard's uncovered_territories
// count and F005's activeTerritoryUserIds exact-match filter. 'overlay' is
// the overlay/secondary assignment concept.
const ASSIGNMENT_ROLE_OPTIONS: SelectOption[] = [
  { value: "primary", label: "Primary owner" },
  { value: "overlay", label: "Overlay (secondary coverage)" },
  { value: "shared", label: "Shared" },
  { value: "manager", label: "Manager" },
];

export function TerritoryAssignmentsDialog({
  territory,
  onOpenChange,
  userOptions,
  teamOptions,
  onError,
}: {
  territory: Territory | null;
  onOpenChange: (open: boolean) => void;
  userOptions: SelectOption[];
  teamOptions: SelectOption[];
  onError: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [assigneeType, setAssigneeType] = useState<"user" | "team">("user");
  const [assigneeId, setAssigneeId] = useState("");
  const [assignmentRole, setAssignmentRole] = useState("primary");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [effectiveTo, setEffectiveTo] = useState("");

  const assignmentsQuery = useQuery({
    queryKey: scopedQueryKey(
      workspace,
      "crm",
      "territory-assignments",
      territory?.id ?? "",
    ),
    queryFn: () => listTerritoryAssignments(territory!.id),
    enabled: Boolean(territory),
  });

  function invalidate() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(
        workspace,
        "crm",
        "territory-assignments",
        territory?.id ?? "",
      ),
    });
  }

  const assigneeOptions = assigneeType === "user" ? userOptions : teamOptions;

  const addMutation = useMutation({
    mutationFn: () =>
      createTerritoryAssignment({
        territoryId: territory!.id,
        assigneeType,
        assigneeId,
        assignmentRole,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
        source: "manual",
      }),
    onSuccess: () => {
      invalidate();
      setAssigneeId("");
      setAssignmentRole("primary");
      setEffectiveFrom("");
      setEffectiveTo("");
    },
    onError,
  });
  // territory-assignments has no archive transition (purely effective-dated)
  // — "ending" coverage sets effectiveTo to today via the governed PATCH
  // path, never a DELETE (which this resource's registry entry has no
  // statusColumn/archiveStatuses mapping for and would reject).
  const endMutation = useMutation({
    mutationFn: (assignment: TerritoryAssignment) =>
      endTerritoryAssignment(
        assignment.id,
        new Date().toISOString().slice(0, 10),
        assignment.updatedAt,
      ),
    onSuccess: invalidate,
    onError,
  });

  const assignments = assignmentsQuery.data?.rows ?? [];
  const isEnded = (assignment: TerritoryAssignment) =>
    Boolean(
      assignment.effectiveTo && new Date(assignment.effectiveTo) <= new Date(),
    );

  return (
    <Dialog
      isOpen={Boolean(territory)}
      onOpenChange={onOpenChange}
      title={territory ? `Assignments for ${territory.name}` : "Assignments"}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          {assignmentsQuery.isLoading && (
            <p className="text-sm text-text-secondary">Loading assignments…</p>
          )}
          {!assignmentsQuery.isLoading && assignments.length === 0 && (
            <p className="text-sm text-text-muted">No coverage assigned yet.</p>
          )}
          {assignments.map((assignment) => {
            const options =
              assignment.assigneeType === "user" ? userOptions : teamOptions;
            const ended = isEnded(assignment);
            return (
              <div
                key={assignment.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-control)] border border-border-strong px-3 py-2"
              >
                <div className="flex flex-col text-sm">
                  <span className="font-medium text-text">
                    {options.find(
                      (option) => option.value === assignment.assigneeId,
                    )?.label ?? assignment.assigneeId}{" "}
                    ({assignment.assigneeType})
                  </span>
                  <span className="text-text-secondary">
                    {assignment.assignmentRole || "Coverage"}
                    {assignment.effectiveFrom
                      ? ` · from ${dateFormatter.format(new Date(assignment.effectiveFrom))}`
                      : ""}
                    {assignment.effectiveTo
                      ? ` · to ${dateFormatter.format(new Date(assignment.effectiveTo))}`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={ended ? "neutral" : "success"}>
                    {ended ? "ended" : "active"}
                  </StatusBadge>
                  {!ended && (
                    <IconButton
                      aria-label="End assignment"
                      size="compact"
                      variant="danger"
                      onPress={() => endMutation.mutate(assignment)}
                    >
                      <Archive className="size-4" aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-3 border-t border-border-strong pt-4">
          <Select
            label="Assignee type"
            options={[
              { value: "user", label: "User" },
              { value: "team", label: "Team" },
            ]}
            selectedKey={assigneeType}
            onSelectionChange={(key) => {
              setAssigneeType(key === "team" ? "team" : "user");
              setAssigneeId("");
            }}
          />
          <Select
            label="Assignee"
            options={assigneeOptions}
            selectedKey={assigneeId}
            onSelectionChange={(key) => setAssigneeId(String(key ?? ""))}
          />
          <Select
            label="Role"
            options={ASSIGNMENT_ROLE_OPTIONS}
            selectedKey={assignmentRole}
            onSelectionChange={(key) =>
              setAssignmentRole(String(key ?? "primary"))
            }
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
            isDisabled={!assigneeId}
          >
            Add assignment
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
