"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CommentThread, type Comment } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "./crm-options-api";
import { createNote, listNotes, NoteApiError } from "./notes-api";

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// F017 Notes, composed into a record 360 — never a standalone global
// screen. Reuses design-system's CommentThread rather than a bespoke
// note-list component, since the shape (author/body/timestamp + a
// composer) is identical.
export function NotesPanel({ entityType, entityId }: { entityType: string; entityId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const notesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "notes", entityType, entityId),
    queryFn: () => listNotes(entityType, entityId),
  });

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const userNames = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return new Map(rows.map((row) => [String(row.id), String(row.fullName || row.name || row.id)]));
  }, [optionsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (body: string) => createNote(entityType, entityId, body),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "notes", entityType, entityId) });
    },
    onError: (err: unknown) => {
      // Previously silent — a failed create (permission, validation,
      // network) left the composer looking like it worked, with the typed
      // text simply gone (CommentThread clears its draft optimistically on
      // submit). Surfacing this doesn't restore the draft, but at least
      // tells the user their note did not save.
      setError(err instanceof NoteApiError ? err.message : "This note could not be saved.");
    },
  });

  const comments: Comment[] = useMemo(() => {
    const notes = notesQuery.data?.notes ?? [];
    return notes.map((note) => ({
      id: note.id,
      authorName: note.createdBy === workspace.userId ? "You" : userNames.get(note.createdBy) || "Someone",
      body: note.body,
      timestamp: dateTimeFormatter.format(new Date(note.createdAt)),
    }));
  }, [notesQuery.data, userNames, workspace.userId]);

  if (notesQuery.isLoading) return <p className="text-sm text-text-secondary">Loading notes…</p>;

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <CommentThread comments={comments} onSubmit={(body) => createMutation.mutate(body)} isSubmitting={createMutation.isPending} />
    </div>
  );
}
