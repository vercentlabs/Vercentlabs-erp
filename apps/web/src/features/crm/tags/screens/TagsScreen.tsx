"use client";

// CRM › Setup › Tags (CRM plan 3.4; companies and contacts: CRM audit): the labels the organization puts on leads, deals, companies and
// contacts. Anyone who edits a record can tag it and make a new tag while doing so; here they are renamed, recoloured, merged (two names
// for one label) or deleted (a deleted tag leaves every record that had it). Each count opens the list filtered by the tag.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Merge, Pencil, Plus, Trash2 } from "lucide-react";
import { AlertDialog, Button, Dialog, EmptyState, ErrorState, PageHeader, PermissionState, SearchField, Select, TextField } from "@vercentlabs/design-system";

import { SetupBackLink } from "@/features/crm/settings/screens/SetupBackLink";
import { TagChip } from "@/features/crm/shared/ui/TagChips";
import { TAG_COLORS, TAG_COLOR_LABELS, createTag, deleteTag, errorMessage, listTags, mergeTag, updateTag, type CrmTag, type TagColor } from "@/features/crm/shared/marketing-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

// Where each count leads: the record list filtered by the tag.
const USES: Array<{ key: "leadCount" | "dealCount" | "companyCount" | "contactCount"; label: string; one: string; href: (id: string) => string }> = [
  { key: "leadCount", label: "Leads", one: "lead", href: (id) => `/crm/leads?view=all&tagId=${id}` },
  { key: "dealCount", label: "Deals", one: "deal", href: (id) => `/crm/opportunities?view=all&tagId=${id}` },
  { key: "companyCount", label: "Companies", one: "company", href: (id) => `/crm/accounts?tagId=${id}` },
  { key: "contactCount", label: "Contacts", one: "contact", href: (id) => `/crm/contacts?tagId=${id}` },
];
const usedOn = (tag: CrmTag) => USES.reduce((sum, use) => sum + (tag[use.key] ?? 0), 0);
const usageText = (tag: CrmTag) => {
  const parts = USES.filter((use) => tag[use.key]).map((use) => `${tag[use.key]} ${tag[use.key] === 1 ? use.one : use.label.toLowerCase()}`);
  return parts.length ? parts.join(", ") : "not on any record";
};

export function TagsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const canManage = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage");
  const key = scopedQueryKey(workspace, "crm", "tags-with-counts");
  const query = useQuery({ queryKey: key, queryFn: () => listTags(true), enabled: canManage });
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CrmTag | "new" | null>(null);
  const [merging, setMerging] = useState<CrmTag | null>(null);
  const [deleting, setDeleting] = useState<CrmTag | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    for (const name of ["tags", "lead-options", "opportunity-options", "account-options", "contact-options"])
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", name) });
  };
  const remove = useMutation({
    mutationFn: (tag: CrmTag) => deleteTag(tag.id),
    onSuccess: (_result, tag) => { setDeleting(null); setNotice({ tone: "success", text: `Deleted ${tag.name}.` }); refresh(); },
    onError: (failure) => { setDeleting(null); setNotice({ tone: "danger", text: errorMessage(failure) }); },
  });
  const tags = useMemo(() => query.data ?? [], [query.data]);
  const shown = useMemo(() => tags.filter((tag) => tag.name.toLowerCase().includes(search.trim().toLowerCase())), [tags, search]);
  const unused = tags.filter((tag) => usedOn(tag) === 0).length;

  if (!canManage) return <PermissionState title="You can't manage tags" description="Ask an administrator for the Manage CRM settings permission." />;
  return (
    <div className="flex flex-col gap-5">
      <SetupBackLink />
      <PageHeader title="Tags" description="Labels on leads, deals, companies and contacts, such as Export, Govt tender or Repeat buyer. Made while tagging a record, or here." />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {/* Find and New tag share one row on every screen size, New tag on the right. */}
      <div className="flex items-center gap-2">
        {tags.length > 0 && <SearchField aria-label="Find a tag" placeholder="Find a tag" className="min-w-0 flex-1 sm:max-w-xs" value={search} onChange={setSearch} />}
        <Button variant="primary" className="ml-auto shrink-0" onPress={() => { setNotice(null); setEditing("new"); }}><Plus className="size-4" aria-hidden="true" />New tag</Button>
      </div>
      {query.isLoading ? <LoadingState label="Loading tags" rows={5} /> : query.isError ? (
        <ErrorState title="Could not load the tags" description={errorMessage(query.error)} action={{ label: "Try again", onPress: () => void query.refetch() }} />
      ) : tags.length === 0 ? (
        <EmptyState title="No tags yet" description="Tag a lead, deal, company or contact from its page, or add a tag here." />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">{`${tags.length} tag${tags.length === 1 ? "" : "s"}${unused ? `, ${unused} not on any record` : ""}. Select a count to see those records.`}</p>
          {shown.length === 0 ? <p className="text-sm text-text-secondary">No tag matches.</p> : (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
              {/* Desktop and tablet: one row per tag, a column per record type. */}
              <table className="hidden w-full text-sm md:table">
                <thead className="border-b border-border bg-surface-muted text-left text-xs text-text-secondary">
                  <tr>
                    <th className="px-4 py-2 font-medium">Tag</th>
                    {USES.map((use) => <th key={use.key} className="px-3 py-2 text-right font-medium">{use.label}</th>)}
                    <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shown.map((tag) => (
                    <tr key={tag.id}>
                      <td className="px-4 py-2.5"><TagChip tag={tag} /></td>
                      {USES.map((use) => <td key={use.key} className="px-3 py-2.5 text-right tabular-nums"><Count tag={tag} use={use} /></td>)}
                      <td className="px-4 py-2.5"><Actions tag={tag} canMerge={tags.length > 1} onEdit={() => setEditing(tag)} onMerge={() => setMerging(tag)} onDelete={() => setDeleting(tag)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Phone: a card per tag. */}
              <ul className="flex flex-col divide-y divide-border md:hidden">
                {shown.map((tag) => (
                  <li key={tag.id} className="flex flex-col gap-3 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="min-w-0"><TagChip tag={tag} /></span>
                      <span className="shrink-0 text-xs text-text-muted">{usedOn(tag) ? `On ${usedOn(tag)} record${usedOn(tag) === 1 ? "" : "s"}` : "Not used yet"}</span>
                    </div>
                    <div className="grid grid-cols-4 divide-x divide-border rounded-[var(--radius-control)] border border-border bg-surface-muted text-center">
                      {USES.map((use) => (
                        <div key={use.key} className="flex flex-col gap-0.5 px-1 py-2">
                          <span className="text-base font-semibold tabular-nums"><Count tag={tag} use={use} /></span>
                          <span className="truncate text-[11px] text-text-muted">{use.label}</span>
                        </div>
                      ))}
                    </div>
                    <Actions tag={tag} canMerge={tags.length > 1} onEdit={() => setEditing(tag)} onMerge={() => setMerging(tag)} onDelete={() => setDeleting(tag)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {editing && <TagDialog tag={editing === "new" ? null : editing} onClose={() => setEditing(null)}
        onSaved={(tag, created) => { setEditing(null); setNotice({ tone: "success", text: created ? `Added ${tag.name}.` : `Saved ${tag.name}.` }); refresh(); }} />}
      {merging && <MergeDialog tag={merging} tags={tags} onClose={() => setMerging(null)}
        onSaved={(into) => { setNotice({ tone: "success", text: `${merging.name} is merged into ${into.name}: ${usageText(into)} now.` }); setMerging(null); refresh(); }} />}
      {deleting && (
        <AlertDialog isOpen onOpenChange={(open) => { if (!open) setDeleting(null); }} title={`Delete the tag ${deleting.name}?`} isConfirming={remove.isPending}
          description={usedOn(deleting) ? `It comes off ${usageText(deleting)}. The records are not changed otherwise. To keep the label under another name, merge it instead.` : "It is not on any record."}
          confirmLabel="Delete tag" onConfirm={() => remove.mutate(deleting)} />
      )}
    </div>
  );
}

function Count({ tag, use }: { tag: CrmTag; use: (typeof USES)[number] }) {
  const count = tag[use.key] ?? 0;
  if (!count) return <span className="text-text-muted">0</span>;
  return <Link className="text-brand hover:underline" href={use.href(tag.id)} aria-label={`${count} ${use.label.toLowerCase()} tagged ${tag.name}`}>{count}</Link>;
}

function Actions({ tag, canMerge, onEdit, onMerge, onDelete }: { tag: CrmTag; canMerge: boolean; onEdit: () => void; onMerge: () => void; onDelete: () => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="secondary" size="compact" aria-label={`Edit ${tag.name}`} onPress={onEdit}><Pencil className="size-3.5" aria-hidden="true" />Edit</Button>
      {canMerge && <Button variant="ghost" size="compact" aria-label={`Merge ${tag.name}`} onPress={onMerge}><Merge className="size-3.5" aria-hidden="true" />Merge</Button>}
      <Button variant="ghost" size="compact" className="text-danger" aria-label={`Delete ${tag.name}`} onPress={onDelete}><Trash2 className="size-3.5" aria-hidden="true" />Delete</Button>
    </div>
  );
}

function ColourPicker({ value, onChange, name }: { value: TagColor; onChange: (value: TagColor) => void; name: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">Colour</span>
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
        {TAG_COLORS.map((color) => (
          <button key={color} type="button" role="radio" aria-checked={color === value} aria-label={TAG_COLOR_LABELS[color]} onClick={() => onChange(color)}
            className={`rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${color === value ? "ring-2 ring-brand" : ""}`}>
            <TagChip tag={{ name: name.trim() || TAG_COLOR_LABELS[color], color }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function TagDialog({ tag, onClose, onSaved }: { tag: CrmTag | null; onClose: () => void; onSaved: (tag: CrmTag, created: boolean) => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<TagColor>(tag?.color ?? "neutral");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => (tag ? updateTag(tag.id, { name, color }) : createTag({ name, color })),
    onSuccess: (saved) => onSaved(saved, !tag),
    onError: (failure) => setError(errorMessage(failure)),
  });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={tag ? `Edit ${tag.name}` : "New tag"}
      description={tag && usedOn(tag) ? `A new name or colour shows on the ${usageText(tag)} that have it.` : undefined}>
      <form className="flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (name.trim()) save.mutate(); }}>
        <TextField label="Name" isRequired maxLength={60} value={name} onChange={(value) => { setName(value); setError(null); }} errorMessage={error ?? undefined} isInvalid={Boolean(error)} />
        <ColourPicker value={color} onChange={setColor} name={name} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" isLoading={save.isPending} isDisabled={!name.trim() || save.isPending}>{tag ? "Save" : "Create tag"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function MergeDialog({ tag, tags, onClose, onSaved }: { tag: CrmTag; tags: CrmTag[]; onClose: () => void; onSaved: (into: CrmTag) => void }) {
  const others = tags.filter((entry) => entry.id !== tag.id);
  const [into, setInto] = useState(others[0]?.id ?? "");
  const merge = useMutation({ mutationFn: () => mergeTag(tag.id, into), onSuccess: (result) => onSaved(result) });
  const target = others.find((entry) => entry.id === into);
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={`Merge ${tag.name}`} description="For two names that mean the same, such as Hot and Hot lead.">
      <div className="flex flex-col gap-4">
        {merge.isError && <Notice>{errorMessage(merge.error)}</Notice>}
        <Select label="Into" selectedKey={into} onSelectionChange={(value) => setInto(String(value))} options={others.map((entry) => ({ value: entry.id, label: entry.name }))} />
        {target && (
          <p className="text-sm text-text-secondary">
            {`The ${usageText(tag)} tagged ${tag.name} get ${target.name} instead (once, where they already have it), and ${tag.name} is deleted.`}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={merge.isPending} isDisabled={!into || merge.isPending} onPress={() => merge.mutate()}>Merge</Button>
        </div>
      </div>
    </Dialog>
  );
}
