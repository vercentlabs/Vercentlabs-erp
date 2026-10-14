"use client";

// The project workspace's Team, Documents and Related tabs. Team: the current members with their project roles, adding existing colleagues
// (a new person is invited through User Management — a new user takes a subscription seat), role changes and removal with the history kept.
// Documents: timestamped notes by their authors, and files read only through the project. Related: the CRM, sales and procurement records
// linked to the project, as their own modules hold them (amounts only for those who may see project financials).
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, LinkButton, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useDebouncedValue } from "@/shared/ui/list";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  addLink, addMember, addNote, changeMemberRole, editNote, errorDetails, errorMessage, fileHref, getFiles, getLinks, getMembers, getNotes, getOptions, getProjectContacts, removeFile, removeLink,
  removeMember, removeNote, searchLinkable, uploadFile, type Project,
} from "../api/projects-api";

const ROLE_OPTIONS = [{ value: "MEMBER", label: "Project Member" }, { value: "VIEWER", label: "Project Viewer" }, { value: "FINANCIAL_VIEWER", label: "Project Financial Viewer" }];
const ROLE_HELP = "Members contribute updates and documents; viewers read; financial viewers also see amounts on linked records. A project role never grants more than the person's company role.";

export function TeamTab({ project, onChanged }: { project: Project; onChanged: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "members", project.id), queryFn: () => getMembers(project.id) });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (team.isLoading) return <LoadingState label="Loading the team" rows={4} />;
  const members = team.data?.members ?? [];
  const current = members.filter((row) => row.active);
  const past = members.filter((row) => !row.active);
  const manage = team.data?.can.manage ?? false;
  const run = async (work: () => Promise<unknown>, text: string) => {
    setBusy(true); setError(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); await onChanged(text); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const candidates = (options.data?.users ?? []).filter((user) => !current.some((row) => row.userId === user.id));
  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Team" description={ROLE_HELP}>
        <LinesTable columns={["Person", "Project role", "Joined", ""]}>
          {current.map((row) => (
            <tr key={row.id}>
              <Cell><span className="flex flex-col"><span>{row.name}</span><span className="text-xs text-text-muted">{row.email}{row.accountActive === false ? " · no longer active" : ""}</span></span></Cell>
              <Cell>{row.role === "MANAGER" || !manage ? <StatusBadge tone={row.role === "MANAGER" ? "info" : "neutral"}>{row.roleLabel}</StatusBadge>
                : <Select aria-label={`Role of ${row.name}`} size="compact" selectedKey={row.role} isDisabled={busy} options={ROLE_OPTIONS}
                    onSelectionChange={(key) => run(() => changeMemberRole(project.id, row.id, String(key)), `${row.name} is now a ${ROLE_OPTIONS.find((option) => option.value === key)?.label}.`)} />}</Cell>
              <Cell>{formatDateTime(row.joinedAt)}{row.addedBy ? ` · ${row.addedBy}` : ""}</Cell>
              <Cell>{manage && row.role !== "MANAGER" && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeMember(project.id, row.id), `${row.name} left the project.`)}>Remove</Button>}</Cell>
            </tr>
          ))}
        </LinesTable>
        {manage && (
          <div className="grid gap-2 sm:grid-cols-[1fr_220px_auto] sm:items-end">
            <ComboBox label="Add a colleague" placeholder="Search people" selectedKey={userId} onSelectionChange={(key) => setUserId(key ? String(key) : null)}
              options={candidates.map((user) => ({ value: user.id, label: `${user.name} · ${user.email}` }))} emptyMessage="No one else can be added." />
            <Select label="Project role" selectedKey={role} onSelectionChange={(key) => setRole(String(key))} options={ROLE_OPTIONS} />
            <Button variant="primary" isLoading={busy} isDisabled={!userId || busy} onPress={() => run(async () => { await addMember(project.id, userId as string, role); setUserId(null); }, "Added to the team; they were told.")}>Add</Button>
          </div>
        )}
        {manage && (
          <p className="text-sm text-text-secondary">
            Someone new to the company? {options.data?.can.inviteUsers
              ? <><LinkButton variant="ghost" size="compact" href="/settings/users">Invite them through User Management</LinkButton> — a new user takes a seat on your subscription; add them here once they join.</>
              : "Ask your administrator to invite them (a new user takes a seat on your subscription); add them here once they join."}
          </p>
        )}
        <p className="text-xs text-text-muted">The Project Manager is changed on the project itself (Edit); the previous manager stays on the team.</p>
      </Panel>
      {past.length > 0 && (
        <Panel title="Former members" description="Their contributions stay attributed to them; they no longer have project access through this team.">
          <LinesTable columns={["Person", "Role", "Joined", "Left"]}>
            {past.map((row) => <tr key={row.id}><Cell>{row.name}</Cell><Cell>{row.roleLabel}</Cell><Cell>{formatDateTime(row.joinedAt)}</Cell>
              <Cell>{formatDateTime(row.leftAt as string)}{row.removedBy ? ` · ${row.removedBy}` : ""}</Cell></tr>)}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

export function DocumentsTab({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const notes = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "notes", project.id), queryFn: () => getNotes(project.id) });
  const files = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "files", project.id), queryFn: () => getFiles(project.id) });
  const [body, setBody] = useState("");
  // A note may record communication with one of the project's customer contacts (kept with the note even after they leave the project).
  const contacts = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "customer-contacts", project.id), queryFn: () => getProjectContacts(project.id),
    enabled: project.classification === "CUSTOMER" && project.can.customer, retry: false });
  const [contactId, setContactId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await work(); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const canAdd = notes.data?.can.add ?? project.can.contribute;
  return (
    <div className="flex flex-col gap-4">
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel title="Notes" description="Project updates and decisions, with who wrote them and when.">
        {canAdd && (
          <div className="flex flex-col gap-2">
            <TextArea aria-label="New note" placeholder="Write an update" value={body} onChange={setBody} maxLength={5000} />
            {(contacts.data?.contacts ?? []).length > 0 && (
              <Select label="With a customer contact" placeholder="Not about a contact" selectedKey={contactId} onSelectionChange={(key) => setContactId(key && key !== "none" ? String(key) : null)}
                options={[{ value: "none", label: "Not about a contact" }, ...[...new Map((contacts.data?.contacts ?? []).map((row) => [row.contactId, row])).values()].map((row) => ({ value: row.contactId, label: row.name }))]} />
            )}
            <div><Button variant="primary" isLoading={busy} isDisabled={!body.trim() || busy} onPress={() => run(async () => { await addNote(project.id, body.trim(), contactId); setBody(""); setContactId(null); })}>Add note</Button></div>
          </div>
        )}
        {notes.isLoading ? <LoadingState label="Loading notes" rows={3} /> : (notes.data?.notes ?? []).length === 0 ? <p className="text-sm text-text-muted">No notes yet.</p> : (
          <ul className="flex flex-col gap-3">
            {(notes.data?.notes ?? []).map((note) => (
              <li key={note.id} className="rounded-md border border-border p-3">
                <p className="text-xs text-text-muted">{`${note.author ?? "Someone"} · ${formatDateTime(note.createdAt)}${note.editedAt ? " · edited" : ""}${note.customerContact ? ` · with ${note.customerContact}` : ""}`}</p>
                {editing?.id === note.id ? (
                  <div className="mt-2 flex flex-col gap-2">
                    <TextArea aria-label="Edit note" value={editing.body} onChange={(value) => setEditing({ ...editing, body: value })} maxLength={5000} />
                    <span className="flex gap-2"><Button size="compact" variant="primary" isDisabled={!editing.body.trim() || busy}
                      onPress={() => run(async () => { await editNote(project.id, note.id, editing.body.trim(), editing.version); setEditing(null); })}>Save</Button>
                      <Button size="compact" variant="ghost" onPress={() => setEditing(null)}>Cancel</Button></span>
                  </div>
                ) : <p className="mt-1 whitespace-pre-wrap text-sm">{note.body}</p>}
                <span className="mt-2 flex gap-2">
                  {note.mine && editing?.id !== note.id && <Button size="compact" variant="ghost" onPress={() => setEditing({ id: note.id, body: note.body, version: note.version })}>Edit</Button>}
                  {note.mayRemove && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeNote(project.id, note.id))}>Remove</Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Files" description="Requirements, scope of work, approvals, drawings and delivery evidence. Opened only through the project (up to 20 MB each)."
        actions={canAdd ? <>
          <input ref={input} type="file" className="hidden" aria-label="Upload a file" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run(() => uploadFile(project.id, file)); }} />
          <Button size="compact" variant="secondary" isLoading={busy} onPress={() => input.current?.click()}>Upload</Button></> : undefined}>
        {files.isLoading ? <LoadingState label="Loading files" rows={2} /> : (files.data ?? []).length === 0 ? <p className="text-sm text-text-muted">No files yet.</p> : (
          <LinesTable columns={["File", { label: "Size", numeric: true }, "Added", ""]}>
            {(files.data ?? []).map((file) => (
              <tr key={file.id}>
                <Cell><a className="text-brand underline" href={fileHref(project.id, file.id)}>{file.fileName}</a></Cell>
                <Cell numeric>{file.sizeBytes > 1048576 ? `${(file.sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`}</Cell>
                <Cell>{formatDateTime(file.uploadedAt)}{file.uploadedBy ? ` · ${file.uploadedBy}` : ""}</Cell>
                <Cell>{(project.can.edit || canAdd) && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => run(() => removeFile(project.id, file.id))}>Remove</Button>}</Cell>
              </tr>
            ))}
          </LinesTable>
        )}
      </Panel>
    </div>
  );
}

const LINK_TYPES = [{ value: "ORIGIN", label: "Origin" }, { value: "DELIVERY", label: "Delivery" }, { value: "BILLING", label: "Billing" }, { value: "RELATED", label: "Related" }];
export function RelatedTab({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "links", project.id), queryFn: () => getLinks(project.id) });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (links.isLoading) return <LoadingState label="Loading linked records" rows={4} />;
  const data = links.data;
  const remove = async (linkId: string) => {
    setBusy(true); setError(null);
    try { await removeLink(project.id, linkId); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Panel title="Related records" description="Records other modules own for this project. They are referenced, never copied: their prices, taxes and payment status stay in their own modules."
      actions={data?.can.manage && data.can.types.length ? <Button size="compact" variant="secondary" onPress={() => setAdding(true)}>Link a record</Button> : undefined}>
      {error && <Notice tone="danger">{error}</Notice>}
      {!data?.links.length ? <p className="text-sm text-text-muted">Nothing linked yet.</p> : (
        <LinesTable columns={["Record", "Status", ...(data.financials ? [{ label: "Amount", numeric: true }, { label: "Outstanding", numeric: true }] : []), "Link", ""]}>
          {data.links.map((link) => {
            const record = link.record;
            const view = "number" in record ? record : null;
            return (
              <tr key={link.id}>
                <Cell><span className="flex flex-col"><span className="text-xs text-text-muted">{link.typeLabel}</span>
                  {view ? <a className="text-brand underline" href={view.href}>{view.number ?? view.title ?? "Open"}{view.title && view.number ? ` · ${view.title}` : ""}</a>
                    : "restricted" in record ? <span className="text-text-muted">You can&apos;t see this record</span> : <span className="text-text-muted">No longer available</span>}</span></Cell>
                <Cell>{view?.status ? view.status.replace(/_/g, " ") : "—"}{view?.billingStatus ? ` · ${view.billingStatus.replace(/_/g, " ")}` : ""}</Cell>
                {data.financials && <Cell numeric>{view?.amount ?? "—"}</Cell>}
                {data.financials && <Cell numeric>{view?.outstanding ?? "—"}</Cell>}
                <Cell>{link.linkType.toLowerCase()}{link.note ? ` · ${link.note}` : ""}</Cell>
                <Cell>{data.can.manage && <Button size="compact" variant="ghost" isDisabled={busy} onPress={() => remove(link.id)}>Unlink</Button>}</Cell>
              </tr>
            );
          })}
        </LinesTable>
      )}
      {adding && data && <LinkDialog project={project} types={data.can.types} onClose={() => setAdding(false)} onDone={() => void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") })} />}
    </Panel>
  );
}

function LinkDialog({ project, types, onClose, onDone }: { project: Project; types: Array<{ type: string; label: string }>; onClose: () => void; onDone: () => void }) {
  const workspace = useWorkspaceContext();
  const [type, setType] = useState(types[0]?.type ?? "");
  const [search, setSearch] = useState("");
  const term = useDebouncedValue(search);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [linkType, setLinkType] = useState("RELATED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A sales order already delivered by another project is linked here too only when the person confirms it.
  const [sharedWith, setSharedWith] = useState<string | null>(null);
  const records = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "link-search", project.id, type, term), queryFn: () => searchLinkable(project.id, type, term), enabled: Boolean(type) });
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title="Link a record" size="md">
      <div className="flex flex-col gap-3">
        {project.classification === "CUSTOMER" && project.customer && <p className="text-sm text-text-secondary">{`Records of ${project.customer} are offered; purchasing records are any of the company's.`}</p>}
        <Select label="Kind of record" selectedKey={type} onSelectionChange={(key) => { setType(String(key)); setRecordId(null); setSharedWith(null); }} options={types.map((row) => ({ value: row.type, label: row.label }))} />
        <ComboBox label="Record" placeholder="Search by number or name" selectedKey={recordId} inputValue={search} onInputChange={setSearch} onSelectionChange={(key) => { setRecordId(key ? String(key) : null); setSharedWith(null); }}
          options={(records.data ?? []).map((row) => ({ value: row.id, label: `${row.number ?? ""}${row.title ? ` · ${row.title}` : ""}${row.status ? ` (${row.status.replace(/_/g, " ")})` : ""}`.trim() }))}
          isLoading={records.isFetching} emptyMessage="Nothing matches." />
        <Select label="How it relates" selectedKey={linkType} onSelectionChange={(key) => setLinkType(String(key))} options={LINK_TYPES} />
        <TextField label="Note" value={note} onChange={setNote} maxLength={500} />
        {sharedWith && <Notice tone="warning">{`This order is already delivered through ${sharedWith}. Link it here as well only if both projects deliver it.`}</Notice>}
        {error && !sharedWith && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={!recordId || busy} onPress={async () => {
            setBusy(true); setError(null);
            try { await addLink(project.id, { sourceType: type, sourceId: recordId, linkType, note: note.trim() || undefined, allowShared: Boolean(sharedWith) }); onDone(); onClose(); } catch (failure) {
              const shared = (errorDetails(failure) as { sharedWith?: string }).sharedWith;
              if (shared && !sharedWith) setSharedWith(shared); else { setSharedWith(null); setError(errorMessage(failure)); }
            } finally { setBusy(false); }
          }}>{sharedWith ? "Link it here as well" : "Link"}</Button>
        </div>
      </div>
    </Dialog>
  );
}
