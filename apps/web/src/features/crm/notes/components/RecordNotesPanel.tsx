"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { History, Lock, Paperclip, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { Button, Checkbox, Dialog, EmptyState, IconButton, StatusBadge, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { RecordAttachmentsPanel } from "@/features/crm/attachments/components/RecordAttachmentsPanel";
import { contentCan } from "../content-permissions";
import { createNote, deleteNote, errorMessage, listNotes, listNoteVersions, pinNote, updateNote, type CrmNote, type CrmRecordType } from "../api/notes-api";
import { isBlankNote, NoteBody, NoteEditor } from "./NoteEditor";

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// The notes on one record: a quick Add Note box, then the notes, pinned
// first and newest next. An opportunity also shows, read-only, the notes of
// the lead it was converted from. The server decides every action.
export function RecordNotesPanel({ relatedType, relatedId }: { relatedType: CrmRecordType; relatedId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CrmNote | null>(null);
  const [historyFor, setHistoryFor] = useState<CrmNote | null>(null);
  const [deleting, setDeleting] = useState<CrmNote | null>(null);
  const [filesFor, setFilesFor] = useState<string | null>(null);
  const canCreate = contentCan(workspace, "crm.notes.create");
  const notes = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "notes", relatedType, relatedId, search.trim()),
    queryFn: () => listNotes(relatedType, relatedId, search.trim() || undefined),
  });

  function refresh() {
    setError(null);
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "notes") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  }
  function failed(failure: unknown, fallback: string) {
    setError(errorMessage(failure, fallback));
    // another person changed the note first: show the current version
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "notes") });
  }

  const pin = useMutation({ mutationFn: (note: CrmNote) => pinNote(note.id, !note.isPinned, note.version), onSuccess: refresh, onError: (failure) => failed(failure, "The note could not be pinned.") });
  const remove = useMutation({
    mutationFn: (note: CrmNote) => deleteNote(note.id, note.version),
    onSuccess: () => { setDeleting(null); refresh(); },
    onError: (failure) => { setDeleting(null); failed(failure, "The note could not be deleted."); },
  });

  const rows = notes.data ?? [];
  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {canCreate && <AddNote relatedType={relatedType} relatedId={relatedId} onSaved={refresh} />}

      <TextField label="Search notes" value={search} onChange={setSearch} placeholder="Search by title or text" />

      {notes.isLoading ? (
        <p className="text-sm text-text-secondary">Loading notes…</p>
      ) : notes.isError ? (
        <p role="alert" className="text-sm text-danger">{errorMessage(notes.error, "The notes could not be loaded.")}</p>
      ) : rows.length === 0 ? (
        <EmptyState title={search.trim() ? "No notes match your search" : "No notes yet"} description={!search.trim() && canCreate ? "Add a note to record call summaries, requirements or decisions." : undefined} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {rows.map((note) => (
            <li key={note.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  {note.title && <span className="text-sm font-semibold text-text">{note.title}</span>}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span className="font-medium text-text">{note.createdBy === workspace.userId ? "You" : (note.createdByName ?? "Someone")}</span>
                    <span>{dateTime.format(new Date(note.createdAt))}</span>
                    {note.isPinned && <StatusBadge tone="info">Pinned</StatusBadge>}
                    {note.fromLead && <StatusBadge tone="neutral">{`From lead ${note.fromLead.code}`}</StatusBadge>}
                    {note.visibility === "private" && <span className="inline-flex items-center gap-1 text-text-muted"><Lock className="size-3" aria-hidden="true" />Private</span>}
                    {note.edited && <span className="text-text-muted">{`Edited ${dateTime.format(new Date(note.updatedAt))}${note.updatedByName ? ` by ${note.updatedByName}` : ""}`}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <IconButton aria-label={`Files on this note (${note.attachmentCount})`} size="compact" variant="ghost" onPress={() => setFilesFor(filesFor === note.id ? null : note.id)}>
                    <Paperclip className="size-4" aria-hidden="true" />
                  </IconButton>
                  {note.edited && <IconButton aria-label="Edit history" size="compact" variant="ghost" onPress={() => setHistoryFor(note)}><History className="size-4" aria-hidden="true" /></IconButton>}
                  {note.canPin && (
                    <IconButton aria-label={note.isPinned ? "Unpin note" : "Pin note"} size="compact" variant="ghost" onPress={() => pin.mutate(note)}>
                      {note.isPinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
                    </IconButton>
                  )}
                  {note.canEdit && <IconButton aria-label="Edit note" size="compact" variant="ghost" onPress={() => setEditing(note)}><Pencil className="size-4" aria-hidden="true" /></IconButton>}
                  {note.canDelete && <IconButton aria-label="Delete note" size="compact" variant="danger" onPress={() => setDeleting(note)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>}
                </div>
              </div>
              <NoteBody html={note.bodyHtml} />
              {note.attachmentCount > 0 && filesFor !== note.id && (
                <button type="button" className="self-start text-xs font-medium text-brand underline" onClick={() => setFilesFor(note.id)}>
                  {note.attachmentCount === 1 ? "1 file" : `${note.attachmentCount} files`}
                </button>
              )}
              {filesFor === note.id && (
                <RecordAttachmentsPanel relatedType={note.relatedType} relatedId={note.relatedId} noteId={note.id} compact readOnly={Boolean(note.fromLead)} />
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <EditNoteDialog note={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {historyFor && <NoteHistoryDialog note={historyFor} onClose={() => setHistoryFor(null)} />}
      {deleting && (
        <Dialog isOpen onOpenChange={(open) => { if (!open) setDeleting(null); }} title="Delete this note?" description="The note is removed from this record and its timeline. The audit log keeps a record of the deletion.">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" isLoading={remove.isPending} onPress={() => remove.mutate(deleting)}>Delete note</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function AddNote({ relatedType, relatedId, onSaved }: { relatedType: CrmRecordType; relatedId: string; onSaved: () => void }) {
  const workspace = useWorkspaceContext();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const canPin = contentCan(workspace, "crm.notes.pin");
  const save = useMutation({
    mutationFn: () => createNote({ relatedType, relatedId, title: title.trim() || undefined, body, isPinned: canPin && isPinned, visibility: isPrivate ? "private" : "shared" }),
    onSuccess: () => { setTitle(""); setBody(""); setIsPrivate(false); setIsPinned(false); onSaved(); },
  });
  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-3">
      {save.isError && <p role="alert" className="text-sm text-danger">{errorMessage(save.error, "The note could not be saved.")}</p>}
      <TextField label="Title" description="Optional." value={title} onChange={setTitle} placeholder="For example: Discovery call summary" />
      <NoteEditor label="Add a note" value={body} onChange={setBody} placeholder="Write a note about this record…" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4">
          <Checkbox isSelected={isPrivate} onChange={setIsPrivate}>Private (only you and administrators)</Checkbox>
          {canPin && <Checkbox isSelected={isPinned} onChange={setIsPinned}>Pin to top</Checkbox>}
        </div>
        <Button variant="primary" isLoading={save.isPending} isDisabled={isBlankNote(body)} onPress={() => save.mutate()}>Add note</Button>
      </div>
    </div>
  );
}

function EditNoteDialog({ note, onClose, onSaved }: { note: CrmNote; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(note.title ?? "");
  const [body, setBody] = useState(note.bodyHtml);
  const [isPrivate, setIsPrivate] = useState(note.visibility === "private");
  const save = useMutation({
    mutationFn: () => updateNote(note.id, { title: title.trim(), body, visibility: isPrivate ? "private" : "shared", expectedVersion: note.version }),
    onSuccess: onSaved,
  });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Edit note" description="The earlier text is kept in the note's edit history." size="lg">
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{errorMessage(save.error, "The note could not be saved.")}</p>}
        <TextField label="Title" description="Optional." value={title} onChange={setTitle} />
        <NoteEditor value={body} onChange={setBody} autoFocus />
        <Checkbox isSelected={isPrivate} onChange={setIsPrivate}>Private (only the author and administrators)</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={isBlankNote(body)} onPress={() => save.mutate()}>Save changes</Button>
        </div>
      </div>
    </Dialog>
  );
}

function NoteHistoryDialog({ note, onClose }: { note: CrmNote; onClose: () => void }) {
  const workspace = useWorkspaceContext();
  const versions = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "notes", "versions", note.id, note.version), queryFn: () => listNoteVersions(note.id) });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Edit history" description="Earlier versions of this note, newest first." size="lg">
      {versions.isLoading ? (
        <p className="text-sm text-text-secondary">Loading history…</p>
      ) : (
        <div className="flex max-h-[420px] flex-col divide-y divide-border overflow-y-auto">
          <div className="flex flex-col gap-1 py-2">
            <span className="text-xs font-medium text-text-secondary">Current</span>
            <NoteBody html={note.bodyHtml} />
          </div>
          {(versions.data ?? []).map((version) => (
            <div key={version.version} className="flex flex-col gap-1 py-2">
              <span className="text-xs text-text-secondary">{`Version ${version.version} · replaced ${dateTime.format(new Date(version.replacedAt))}${version.replacedByName ? ` by ${version.replacedByName}` : ""}`}</span>
              <p className="whitespace-pre-wrap text-sm text-text-secondary">{version.bodyText}</p>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
