"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Select, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { assignLeadTag, listLeadTags, listTagDefinitions, removeLeadTag, TagApiError } from "./lead-tags-api";

// F028 Tranche C — tag ASSIGNMENT on a Lead 360, distinct from the Setup
// tag-definitions library (CRM Setup > Custom fields and tags). Lead-only:
// tenant.crm_lead_tags is the only tag-assignment junction the schema has.
export function LeadTagsPanel({ leadId, canManage }: { leadId: string; canManage: boolean }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [pendingTagId, setPendingTagId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const tagsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "lead-tags", leadId),
    queryFn: () => listLeadTags(leadId),
  });
  const definitionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "tag-definitions"),
    queryFn: () => listTagDefinitions(),
    enabled: canManage,
  });

  const assigned = tagsQuery.data?.rows ?? [];
  const assignedIds = new Set(assigned.map((row) => row.tagId));
  const availableOptions: SelectOption[] = (definitionsQuery.data?.rows ?? [])
    .filter((tag) => !assignedIds.has(tag.id))
    .map((tag) => ({ value: tag.id, label: tag.name }));

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-tags", leadId) });
  }

  const assignMutation = useMutation({
    mutationFn: (tagId: string) => assignLeadTag(leadId, tagId),
    onSuccess: () => {
      setError(null);
      setPendingTagId("");
      invalidate();
    },
    onError: (err: unknown) => setError(err instanceof TagApiError ? err.message : "That tag could not be added."),
  });
  const removeMutation = useMutation({
    mutationFn: (tagId: string) => removeLeadTag(leadId, tagId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err: unknown) => setError(err instanceof TagApiError ? err.message : "That tag could not be removed."),
  });

  if (tagsQuery.isLoading) return <p className="text-sm text-text-secondary">Loading tags…</p>;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {assigned.length === 0 && <span className="text-sm text-text-muted">No tags</span>}
        {assigned.map((tag) => (
          <Badge key={tag.tagId} className="gap-1" style={{ borderColor: tag.color, color: tag.color }}>
            {tag.name}
            {canManage && (
              <button
                type="button"
                aria-label={`Remove tag ${tag.name}`}
                onClick={() => removeMutation.mutate(tag.tagId)}
                disabled={removeMutation.isPending}
                className="rounded-full hover:bg-danger-soft"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {canManage && availableOptions.length > 0 && (
        <div className="flex items-end gap-2">
          <Select
            label="Add tag"
            options={availableOptions}
            selectedKey={pendingTagId}
            onSelectionChange={(key) => setPendingTagId(key ? String(key) : "")}
          />
          <Button
            variant="secondary"
            size="compact"
            isDisabled={!pendingTagId || assignMutation.isPending}
            isLoading={assignMutation.isPending}
            onPress={() => pendingTagId && assignMutation.mutate(pendingTagId)}
          >
            Add
          </Button>
        </div>
      )}
    </div>
  );
}
