"use client";

// CRM › Setup › Tags (CRM plan 3.4): the labels the organization puts on leads and deals. Anyone who edits a lead or deal can tag it and
// make a new tag while doing so; here they are renamed, recoloured, or deleted (a deleted tag leaves every record that had it).
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { AlertDialog, Button, Dialog, EnterpriseDataGrid, EnterpriseListPage, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { gridStates } from "@/features/crm/shared/ui/gridStates";
import { MoreMenu } from "@/features/crm/shared/ui/MoreMenu";
import { TagChip } from "@/features/crm/shared/ui/TagChips";
import { TAG_COLORS, TAG_COLOR_LABELS, createTag, deleteTag, errorMessage, listTags, updateTag, type CrmTag, type TagColor } from "@/features/crm/shared/marketing-api";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function TagsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "tags-with-counts");
  const query = useQuery({ queryKey: key, queryFn: () => listTags(true), enabled: canManage });
  const [editing, setEditing] = useState<CrmTag | "new" | null>(null);
  const [deleting, setDeleting] = useState<CrmTag | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "lead-options") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "opportunity-options") });
  };
  const remove = useMutation({
    mutationFn: (tag: CrmTag) => deleteTag(tag.id),
    onSuccess: () => { setDeleting(null); setError(null); refresh(); }, onError: (failure) => setError(errorMessage(failure)),
  });
  const rows = query.data ?? [];
  const columns = useMemo<ColumnDef<CrmTag, unknown>[]>(() => [
    { id: "name", header: "Tag", cell: ({ row }) => <TagChip tag={row.original} /> },
    { id: "leads", header: "Leads", cell: ({ row }) => <Link className="tabular-nums hover:underline" href={`/crm/leads?view=all&tagId=${row.original.id}`}>{row.original.leadCount ?? 0}</Link> },
    { id: "deals", header: "Deals", cell: ({ row }) => <Link className="tabular-nums hover:underline" href={`/crm/opportunities?view=all&tagId=${row.original.id}`}>{row.original.dealCount ?? 0}</Link> },
  ], []);

  if (!canManage) return <PermissionState title="You can't manage tags" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-4">
      <SetupBackLink />
      {error && <Notice>{error}</Notice>}
      <EnterpriseListPage
        header={{
          title: "Tags",
          description: "Labels on leads and deals, such as Export, Govt tender or Repeat buyer. They are made while tagging a record, or here.",
          primaryAction: <Button variant="primary" onPress={() => setEditing("new")}><Plus className="size-4" aria-hidden="true" />New tag</Button>,
        }}
      >
        <EnterpriseDataGrid<CrmTag>
          aria-label="Tags"
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          {...gridStates(query, rows.length, "tags", { title: "No tags yet", description: "Tag a lead or deal, or add a tag here." })}
          rowActions={(row) => (
            <span onClick={(event) => event.stopPropagation()}>
              <MoreMenu label={`Actions for ${row.name}`} items={[
                { id: "edit", label: "Rename or recolour", onAction: () => setEditing(row) },
                { id: "delete", label: "Delete", onAction: () => setDeleting(row) },
              ]} />
            </span>
          )}
          renderMobileCard={(row) => <div className="flex items-center justify-between"><TagChip tag={row} /><span className="text-xs text-text-muted">{row.leadCount ?? 0} leads · {row.dealCount ?? 0} deals</span></div>}
        />
      </EnterpriseListPage>
      {editing && <TagDialog tag={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {deleting && (
        <AlertDialog isOpen onOpenChange={(open) => { if (!open) setDeleting(null); }} title={`Delete the tag ${deleting.name}?`} isConfirming={remove.isPending}
          description={`It comes off ${deleting.leadCount ?? 0} leads and ${deleting.dealCount ?? 0} deals. The records themselves are not changed otherwise.`}
          confirmLabel="Delete tag" onConfirm={() => remove.mutate(deleting)} />
      )}
    </div>
  );
}

function TagDialog({ tag, onClose, onSaved }: { tag: CrmTag | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<TagColor>(tag?.color ?? "neutral");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => (tag ? updateTag(tag.id, { name, color }) : createTag({ name, color })),
    onSuccess: onSaved,
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={tag ? `Edit ${tag.name}` : "New tag"}>
      <div className="flex flex-col gap-4">
        <TextField label="Name" isRequired value={name} onChange={setName} errorMessage={error ?? undefined} isInvalid={Boolean(error)} />
        <Select label="Colour" selectedKey={color} onSelectionChange={(value) => setColor(String(value) as TagColor)}
          options={TAG_COLORS.map((value) => ({ value, label: TAG_COLOR_LABELS[value] }))} />
        <div><TagChip tag={{ name: name || "Preview", color }} /></div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>{tag ? "Save" : "Create tag"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
