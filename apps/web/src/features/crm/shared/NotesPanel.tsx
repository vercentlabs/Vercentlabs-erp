"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, History, Lock, Pencil, Pin, PinOff } from "lucide-react";
import { Button, Checkbox, Dialog, IconButton, StatusBadge, TextArea } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "./crm-options-api";
import { archiveNote, createNote, listNotes, listNoteVersions, NoteApiError, updateNote, type CrmNote } from "./notes-api";
import { canWriteCrmRecordContent } from "./record-content-permissions";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// F017 Notes, composed into a record 360 — never a standalone global screen.
// The backend (notes-operations.js) already governed private visibility,
// author-only edits, optimistic-concurrency edits, append-only version
// history and archive-not-delete; this panel previously only listed and
// created shared notes, so none of that was reachable. Edit/archive rights
// mirror the server rule (author, or an organization-wide override) purely to
// avoid offering an action the server would reject — the server still decides.
export function NotesPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftPrivate, setDraftPrivate] = useState(false);
  const [editing, setEditing] = useState<CrmNote | null>(null);
  const [historyFor, setHistoryFor] = useState<CrmNote | null>(null);
  // Mirrors canOverridePrivateCrmContent (crm-access-scope.js).
  const canWrite = canWriteCrmRecordContent(workspace, entityType);
  const canOverride = workspace.roleSlugs.includes("organization_owner") || (workspace.permissions.includes("crm.records.view_all") && workspace.permissions.includes("crm.settings.manage"));
  const notesKey = scopedQueryKey(workspace, "crm", "notes", entityType, entityId);

  const notesQuery = useQuery({ queryKey: notesKey, queryFn: () => listNotes(entityType, entityId) });
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const userNames = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return new Map(rows.map((row) => [String(row.id), String(row.fullName || row.name || row.id)]));
  }, [optionsQuery.data]);

  function refresh() {
    queryClient.invalidateQueries({ queryKey: notesKey });
  }
  function fail(err: unknown, fallback: string) {
    setError(err instanceof NoteApiError ? err.message : fallback);
    if (err instanceof NoteApiError && err.code === "CRM_NOTE_STALE_WRITE") refresh();
  }

  const createMutation = useMutation({
    mutationFn: () => createNote(entityType, entityId, draft.trim(), draftPrivate ? "private" : "shared"),
    onSuccess: () => {
      setError(null);
      setDraft("");
      setDraftPrivate(false);
      refresh();
    },
    onError: (err: unknown) => fail(err, "This note could not be saved."),
  });
  const pinMutation = useMutation({
    mutationFn: (note: CrmNote) => updateNote(note.id, { isPinned: !note.isPinned }, note.version),
    onSuccess: () => { setError(null); refresh(); },
    onError: (err: unknown) => fail(err, "This note could not be updated."),
  });
  const archiveMutation = useMutation({
    mutationFn: (note: CrmNote) => archiveNote(note.id, note.version),
    onSuccess: () => { setError(null); refresh(); },
    onError: (err: unknown) => fail(err, "This note could not be archived."),
  });

  const notes = notesQuery.data?.notes ?? [];
  if (notesQuery.isLoading) return <p className="text-sm text-text-secondary">Loading notes…</p>;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {canWrite && (
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3">
        <TextArea label="Add a note" value={draft} onChange={setDraft} placeholder="Write a note about this record…" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Checkbox isSelected={draftPrivate} onChange={setDraftPrivate}>Private — only I and administrators can see this note</Checkbox>
          <Button variant="primary" onPress={() => createMutation.mutate()} isLoading={createMutation.isPending} isDisabled={!draft.trim()}>
            Add note
          </Button>
        </div>
      </div>
      )}

      {notes.length === 0 ? (
        <p className="text-sm text-text-muted">No notes yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {notes.map((note) => {
            const mine = note.createdBy === workspace.userId;
            const canEdit = canWrite && (mine || canOverride);
            const author = mine ? "You" : note.createdByName || userNames.get(note.createdBy) || "Someone";
            return (
              <li key={note.id} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                    <span className="font-medium text-text">{author}</span>
                    <span>{dateTimeFormatter.format(new Date(note.createdAt))}</span>
                    {note.isPinned && <StatusBadge tone="info">Pinned</StatusBadge>}
                    {note.visibility === "private" && (
                      <span className="inline-flex items-center gap-1 text-text-muted"><Lock className="size-3" aria-hidden="true" />Private</span>
                    )}
                    {note.version > 1 && <span className="text-text-muted">{`Edited · v${note.version}`}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    {note.version > 1 && (
                      <IconButton aria-label="View note history" size="compact" variant="ghost" onPress={() => setHistoryFor(note)}>
                        <History className="size-4" aria-hidden="true" />
                      </IconButton>
                    )}
                    {canEdit && (
                      <>
                        <IconButton aria-label={note.isPinned ? "Unpin note" : "Pin note"} size="compact" variant="ghost" onPress={() => pinMutation.mutate(note)}>
                          {note.isPinned ? <PinOff className="size-4" aria-hidden="true" /> : <Pin className="size-4" aria-hidden="true" />}
                        </IconButton>
                        <IconButton aria-label="Edit note" size="compact" variant="ghost" onPress={() => setEditing(note)}>
                          <Pencil className="size-4" aria-hidden="true" />
                        </IconButton>
                        <IconButton aria-label="Archive note" size="compact" variant="danger" onPress={() => archiveMutation.mutate(note)}>
                          <Archive className="size-4" aria-hidden="true" />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm text-text">{note.body}</p>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <EditNoteDialog note={editing} onOpenChange={(open) => { if (!open) setEditing(null); }} onSaved={() => { setEditing(null); setError(null); refresh(); }} onError={(err) => fail(err, "This note could not be saved.")} />}
      {historyFor && <NoteHistoryDialog note={historyFor} onOpenChange={(open) => { if (!open) setHistoryFor(null); }} />}
    </div>
  );
}

function EditNoteDialog({ note, onOpenChange, onSaved, onError }: { note: CrmNote; onOpenChange: (open: boolean) => void; onSaved: () => void; onError: (err: unknown) => void }) {
  const [body, setBody] = useState(note.body);
  const [isPrivate, setIsPrivate] = useState(note.visibility === "private");
  const mutation = useMutation({
    mutationFn: () => updateNote(note.id, { body: body.trim(), visibility: isPrivate ? "private" : "shared" }, note.version),
    onSuccess: onSaved,
    onError: (err: unknown) => { onOpenChange(false); onError(err); },
  });
  return (
    <Dialog isOpen onOpenChange={onOpenChange} title="Edit note" description="The previous text is kept in the note's history.">
      <div className="flex flex-col gap-4">
        <TextArea label="Note" value={body} onChange={setBody} />
        <Checkbox isSelected={isPrivate} onChange={setIsPrivate}>Private — only the author and administrators can see this note</Checkbox>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending} isDisabled={!body.trim()}>
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function NoteHistoryDialog({ note, onOpenChange }: { note: CrmNote; onOpenChange: (open: boolean) => void }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "notes", "versions", note.id, note.version), queryFn: () => listNoteVersions(note.id) });
  const versions = query.data?.versions ?? [];
  return (
    <Dialog isOpen onOpenChange={onOpenChange} title="Note history" description="Every earlier version of this note, newest first." size="lg">
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading history…</p>
      ) : (
        <div className="flex max-h-[420px] flex-col divide-y divide-border overflow-y-auto">
          <div className="flex flex-col gap-1 py-2">
            <span className="text-xs font-medium text-text-secondary">{`Current — v${note.version}`}</span>
            <p className="whitespace-pre-wrap text-sm text-text">{note.body}</p>
          </div>
          {versions.map((version) => (
            <div key={version.id} className="flex flex-col gap-1 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary">
                <span className="font-medium">{`v${version.version}`}</span>
                <span>{dateTimeFormatter.format(new Date(version.createdAt))}</span>
                <span>{version.actorName ? `Replaced by ${version.actorName}` : "Replaced"}</span>
                {version.visibility === "private" && <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden="true" />Was private</span>}
              </div>
              <p className="whitespace-pre-wrap text-sm text-text-secondary">{version.body}</p>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
