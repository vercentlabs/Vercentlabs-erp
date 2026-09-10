"use client";

import { useEffect, useState } from "react";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, FormField, StatePanel, StatusBadge } from "@/shared/design";
import styles from "./timeline-panel.module.css";

type NoteItem = {
  id: string;
  body: string;
  isPinned: boolean;
  visibility: "shared" | "private";
  version: number;
  createdBy: string;
  createdByName?: string | null;
  createdAt: string;
  archivedAt?: string | null;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

// F017 closeout — the shared rendering surface for the canonical Notes
// domain (notes-operations.js), consumed by Account/Contact/Opportunity
// 360 (none of the three had any Notes UI before this). Lead keeps its own
// existing, already-tested inline Notes tab rather than being migrated
// onto this component in the same pass — same domain module underneath
// either way, so there is still only one Notes security implementation.
export default function NotesPanel({
  listEndpoint,
  currentUserId,
  canManage,
}: {
  listEndpoint: string;
  currentUserId: string;
  canManage: boolean;
}) {
  const [notes, setNotes] = useState<NoteItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [message, setMessage] = useState("");
  // Bumped after every mutation to re-trigger the fetch effect below —
  // matches timeline-panel.tsx's own load-inside-effect shape rather than
  // calling a component-scope async setState function directly inside a
  // useEffect body (flagged by react-hooks/set-state-in-effect).
  const [refreshKey, setRefreshKey] = useState(0);
  function reload() {
    setRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await requestJson<{ notes?: NoteItem[] }>(listEndpoint);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "Notes could not be loaded.");
        setNotes([]);
        return;
      }
      setNotes(result.notes || []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [listEndpoint, refreshKey]);

  async function createNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setMessage("");
    const result = await requestJson<{ note?: NoteItem }>(listEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, isPinned, visibility: isPrivate ? "private" : "shared" }),
    });
    setSubmitting(false);
    if (!result.ok) {
      setMessage(result.message || "Note could not be saved.");
      return;
    }
    setBody("");
    setIsPinned(false);
    setIsPrivate(false);
    reload();
  }

  async function saveEdit(note: NoteItem) {
    const result = await requestJson<{ note?: NoteItem }>(`/api/crm/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: editBody, expectedVersion: note.version }),
    });
    if (!result.ok) {
      if (result.status === 409) {
        setMessage("This Note changed since you opened it. Reloading the latest version.");
        reload();
        return;
      }
      setMessage(result.message || "Note could not be updated.");
      return;
    }
    setEditingId(null);
    reload();
  }

  async function archive(note: NoteItem) {
    const result = await requestJson(`/api/crm/notes/${note.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: note.version }),
    });
    if (!result.ok) {
      setMessage(result.message || "Note could not be archived.");
      return;
    }
    reload();
  }

  return (
    <div>
      {canManage ? (
        <form className="crm-suite-form" onSubmit={createNote}>
          <FormField label="Note" htmlFor="notes-panel-body" required>
            <textarea id="notes-panel-body" value={body} onChange={(event) => setBody(event.target.value)} required rows={4} />
          </FormField>
          <label className="crm-suite-check">
            <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
            <span>Pin this note</span>
          </label>
          <label className="crm-suite-check">
            <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} />
            <span>Private — visible only to me and managers</span>
          </label>
          <ActionButton type="submit" tone="primary" busy={submitting}>
            {submitting ? "Saving…" : "Add note"}
          </ActionButton>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}

      {notes === null ? <StatePanel title="Loading notes…" /> : null}
      {notes && loadError && !notes.length ? <StatePanel title="Notes could not be loaded." description={loadError} /> : null}
      {notes && !notes.length && !loadError ? <StatePanel title="No notes yet." /> : null}
      {notes && notes.length ? (
        <ul className={styles.list}>
          {notes.map((note) => (
            <li key={note.id} className={styles.item}>
              <div className={styles.itemHeading}>
                <strong>{note.isPinned ? "Pinned note" : "Note"}</strong>
                {note.visibility === "private" ? <StatusBadge tone="neutral">Private</StatusBadge> : null}
              </div>
              {editingId === note.id ? (
                <>
                  <textarea value={editBody} onChange={(event) => setEditBody(event.target.value)} rows={4} />
                  <div>
                    <ActionButton type="button" tone="primary" onClick={() => void saveEdit(note)}>Save</ActionButton>
                    <ActionButton type="button" tone="quiet" onClick={() => setEditingId(null)}>Cancel</ActionButton>
                  </div>
                </>
              ) : (
                <p>{note.body}</p>
              )}
              <span className={styles.itemMeta}>
                {note.createdByName || "Team member"} · {formatDate(note.createdAt)}
              </span>
              {note.createdBy === currentUserId && editingId !== note.id ? (
                <div>
                  <ActionButton type="button" tone="quiet" onClick={() => { setEditingId(note.id); setEditBody(note.body); }}>Edit</ActionButton>
                  <ActionButton type="button" tone="quiet" onClick={() => void archive(note)}>Archive</ActionButton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
