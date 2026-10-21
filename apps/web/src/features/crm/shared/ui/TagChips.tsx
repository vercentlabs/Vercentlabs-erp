"use client";

// A record's tags as small coloured chips, and (with canEdit) an editor to add, make and remove them in place.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button, ComboBox, cn } from "@vercentlabs/design-system";

import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, setRecordTags, type CrmTag, type TagColor, type TaggedEntity } from "../marketing-api";

const TONE: Record<TagColor, string> = {
  neutral: "bg-surface-muted text-text-secondary border-border",
  blue: "bg-info-soft text-info border-info-emphasis/30",
  green: "bg-success-soft text-success border-success-emphasis/30",
  amber: "bg-warning-soft text-warning border-warning-emphasis/30",
  red: "bg-danger-soft text-danger border-danger-emphasis/30",
  purple: "bg-brand-soft text-brand border-brand/30",
  teal: "bg-success-soft text-text border-border",
};

export function TagChip({ tag, onRemove }: { tag: Pick<CrmTag, "name" | "color">; onRemove?: () => void }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", TONE[tag.color] ?? TONE.neutral)}>
      {tag.name}
      {onRemove && (
        <button type="button" aria-label={`Remove the tag ${tag.name}`} className="rounded-full hover:opacity-70 focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none" onClick={onRemove}>
          <X className="size-3" aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

export function TagList({ tags }: { tags: Array<Pick<CrmTag, "id" | "name" | "color">> | undefined }) {
  if (!tags?.length) return null;
  return <span className="flex flex-wrap gap-1">{tags.map((tag) => <TagChip key={tag.id} tag={tag} />)}</span>;
}

// The tags of one lead or deal, editable in place: pick an existing tag or type a new one.
export function TagEditor({ entity, recordId, tags, available, canEdit, onChanged }: {
  entity: TaggedEntity; recordId: string; tags: CrmTag[]; available: CrmTag[]; canEdit: boolean; onChanged: (tags: CrmTag[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: Array<{ id: string } | { name: string }>) => setRecordTags(entity, recordId, next),
    onSuccess: (next) => {
      setError(null); setAdding(false); setTyped("");
      // A tag made here joins the tags offered everywhere.
      if (next.some((tag) => !available.some((entry) => entry.id === tag.id)))
        for (const key of ["lead-options", "opportunity-options", "tags"]) void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", key) });
      onChanged(next);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });
  const current = tags.map((tag) => ({ id: tag.id }));
  const choices = available.filter((tag) => !tags.some((entry) => entry.id === tag.id));
  const add = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const existing = available.find((tag) => tag.name.toLowerCase() === clean.toLowerCase());
    save.mutate([...current, existing ? { id: existing.id } : { name: clean }]);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <TagChip key={tag.id} tag={tag} onRemove={canEdit && !save.isPending ? () => save.mutate(current.filter((entry) => entry.id !== tag.id)) : undefined} />
        ))}
        {!tags.length && !adding && <span className="text-xs text-text-muted">No tags</span>}
        {canEdit && !adding && (
          <Button variant="ghost" size="compact" onPress={() => setAdding(true)}><Plus className="size-3.5" aria-hidden="true" />Tag</Button>
        )}
      </div>
      {adding && (
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); add(typed); }}>
          <ComboBox aria-label="Add a tag" size="compact" allowsCustomValue inputValue={typed} onInputChange={setTyped}
            onSelectionChange={(key) => { const tag = choices.find((entry) => entry.id === key); if (tag) save.mutate([...current, { id: tag.id }]); }}
            options={choices.map((tag) => ({ value: tag.id, label: tag.name }))} placeholder="Pick or type a new tag" />
          <Button type="submit" variant="secondary" size="compact" isLoading={save.isPending} isDisabled={!typed.trim()}>Add</Button>
          <Button variant="ghost" size="compact" onPress={() => { setAdding(false); setTyped(""); }}>Cancel</Button>
        </form>
      )}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
