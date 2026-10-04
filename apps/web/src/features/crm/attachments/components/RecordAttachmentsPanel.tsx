"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, FileText, Pencil, Trash2, Upload } from "lucide-react";
import { Button, Dialog, EmptyState, IconButton, ProgressBar, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { contentCan } from "@/features/crm/notes/content-permissions";
import {
  attachmentDownloadUrl, deleteAttachment, errorMessage, formatSize, listAttachments, updateAttachment, uploadAttachment,
  type CrmAttachment, type CrmRecordType,
} from "@/features/crm/notes/api/notes-api";

const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });
const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.txt,.csv";
const KINDS = [
  { value: "all", label: "All files" }, { value: "document", label: "Documents" }, { value: "spreadsheet", label: "Spreadsheets" },
  { value: "presentation", label: "Presentations" }, { value: "image", label: "Images" },
];
const SORTS = [{ value: "uploadedAt", label: "Newest first" }, { value: "name", label: "Name" }, { value: "type", label: "Type" }, { value: "uploadedBy", label: "Uploaded by" }];

type Upload = { key: string; name: string; progress: number; error?: string };

// The files on one record (or, with noteId, on one of its notes): drag and
// drop or choose several files, each uploaded with its own progress. The
// server checks every file's type and content and decides every action.
export function RecordAttachmentsPanel({ relatedType, relatedId, noteId, compact = false, readOnly = false }: {
  relatedType: CrmRecordType; relatedId: string; noteId?: string; compact?: boolean; readOnly?: boolean;
}) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("all");
  const [sortBy, setSortBy] = useState("uploadedAt");
  const [description, setDescription] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<CrmAttachment | null>(null);
  const [editing, setEditing] = useState<CrmAttachment | null>(null);
  const [deleting, setDeleting] = useState<CrmAttachment | null>(null);
  const canUpload = !readOnly && contentCan(workspace, "crm.attachments.upload");
  const filters = { kind: kind === "all" ? undefined : kind, sortBy, noteId };
  const key = scopedQueryKey(workspace, "crm", "attachments", relatedType, relatedId, filters);
  const files = useQuery({ queryKey: key, queryFn: () => listAttachments(relatedType, relatedId, filters) });

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "attachments", relatedType, relatedId) });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "notes") });
    void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "timeline") });
  }

  async function uploadFiles(list: FileList | File[]) {
    const chosen = Array.from(list);
    if (!chosen.length) return;
    setError(null);
    const batch = chosen.map((file) => ({ file, key: crypto.randomUUID() }));
    setUploads((current) => [...current, ...batch.map(({ file, key: id }) => ({ key: id, name: file.name, progress: 0 }))]);
    const note = description.trim() || undefined;
    await Promise.all(batch.map(async ({ file, key: id }) => {
      try {
        await uploadAttachment({ relatedType, relatedId, file, description: note, noteId, idempotencyKey: id },
          (progress) => setUploads((current) => current.map((entry) => (entry.key === id ? { ...entry, progress } : entry))));
        setUploads((current) => current.filter((entry) => entry.key !== id));
      } catch (failure) {
        setUploads((current) => current.map((entry) => (entry.key === id ? { ...entry, error: errorMessage(failure, "The file could not be uploaded.") } : entry)));
      }
    }));
    setDescription("");
    refresh();
  }

  const remove = useMutation({
    mutationFn: (file: CrmAttachment) => deleteAttachment(file.id),
    onSuccess: () => { setDeleting(null); refresh(); },
    onError: (failure) => { setDeleting(null); setError(errorMessage(failure, "The file could not be deleted.")); },
  });

  const rows = files.data ?? [];
  return (
    <div className="flex flex-col gap-3">
      {error && <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {canUpload && (
        <div
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); void uploadFiles(event.dataTransfer.files); }}
          className={`flex flex-col gap-3 rounded-[var(--radius-card)] border border-dashed p-3 ${dragging ? "border-brand bg-surface-muted" : "border-border bg-surface"}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            <Upload className="size-5 text-text-secondary" aria-hidden="true" />
            <p className="flex-1 text-sm text-text-secondary">
              {compact ? "Drop files here to attach them to this note." : "Drop files here, or choose them. PDF, Word, Excel, PowerPoint, JPG, PNG, TXT and CSV are accepted."}
            </p>
            <Button variant="secondary" size="compact" onPress={() => input.current?.click()}>Choose files</Button>
            <input ref={input} type="file" multiple accept={ACCEPT} className="hidden"
              onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ""; }} />
          </div>
          {!compact && <TextField label="Description" description="Optional. Saved with the files you upload next." value={description} onChange={setDescription} />}
          {uploads.map((entry) => (
            <div key={entry.key} className="flex flex-col gap-1">
              {entry.error ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-danger">{`${entry.name}: ${entry.error}`}</span>
                  <Button variant="ghost" size="compact" onPress={() => setUploads((current) => current.filter((item) => item.key !== entry.key))}>Dismiss</Button>
                </div>
              ) : (
                <ProgressBar label={entry.name} value={Math.round(entry.progress * 100)} />
              )}
            </div>
          ))}
        </div>
      )}

      {!compact && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Show" selectedKey={kind} onSelectionChange={(value) => setKind(String(value))} options={KINDS} />
          <Select label="Sort by" selectedKey={sortBy} onSelectionChange={(value) => setSortBy(String(value))} options={SORTS} />
        </div>
      )}

      {files.isLoading ? (
        <p className="text-sm text-text-secondary">Loading files…</p>
      ) : files.isError ? (
        <p role="alert" className="text-sm text-danger">{errorMessage(files.error, "The files could not be loaded.")}</p>
      ) : rows.length === 0 ? (
        compact ? <p className="text-sm text-text-muted">No files on this note.</p> : <EmptyState title="No files yet" description={canUpload ? "Upload proposals, contracts or other documents for this record." : undefined} />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
          {rows.map((file) => (
            <li key={file.id} className="flex flex-wrap items-center gap-3 p-3">
              <FileText className="size-5 shrink-0 text-text-secondary" aria-hidden="true" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-text">{file.fileName}</span>
                  {file.fromLead && <StatusBadge tone="neutral">{`From lead ${file.fromLead.code}`}</StatusBadge>}
                  {file.noteId && !noteId && <StatusBadge tone="info">On a note</StatusBadge>}
                </div>
                {file.description && <span className="text-sm text-text-secondary">{file.description}</span>}
                <span className="text-xs text-text-muted">
                  {[file.mimeType.split("/").pop()?.toUpperCase().slice(0, 12), formatSize(file.sizeBytes), file.uploadedByName ?? "Unknown", dateTime.format(new Date(file.uploadedAt))].join(" · ")}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {file.preview && file.canDownload && (
                  <IconButton aria-label={`Preview ${file.fileName}`} size="compact" variant="ghost" onPress={() => setPreview(file)}><Eye className="size-4" aria-hidden="true" /></IconButton>
                )}
                {file.canDownload && (
                  <a href={attachmentDownloadUrl(file.id)} aria-label={`Download ${file.fileName}`} title="Download"
                    className="inline-flex size-[var(--control-height-compact)] items-center justify-center rounded-[var(--radius-control)] text-text-secondary hover:bg-surface-hover hover:text-text">
                    <Download className="size-4" aria-hidden="true" />
                  </a>
                )}
                {!readOnly && file.canEdit && (
                  <IconButton aria-label={`Rename ${file.fileName}`} size="compact" variant="ghost" onPress={() => setEditing(file)}><Pencil className="size-4" aria-hidden="true" /></IconButton>
                )}
                {!readOnly && file.canDelete && (
                  <IconButton aria-label={`Delete ${file.fileName}`} size="compact" variant="danger" onPress={() => setDeleting(file)}><Trash2 className="size-4" aria-hidden="true" /></IconButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <Dialog isOpen onOpenChange={(open) => { if (!open) setPreview(null); }} title={preview.fileName} size="lg">
          <div className="flex flex-col gap-3">
            {preview.preview === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private, authorized file, not a static asset
              <img src={attachmentDownloadUrl(preview.id, true)} alt={preview.fileName} className="max-h-[70vh] w-full object-contain" />
            ) : (
              <iframe src={attachmentDownloadUrl(preview.id, true)} title={preview.fileName} className="h-[70vh] w-full rounded border border-border bg-white" />
            )}
            <div className="flex justify-end">
              <a href={attachmentDownloadUrl(preview.id)} className="text-sm font-medium text-brand underline">Download</a>
            </div>
          </div>
        </Dialog>
      )}
      {editing && <EditAttachmentDialog file={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {deleting && (
        <Dialog isOpen onOpenChange={(open) => { if (!open) setDeleting(null); }} title="Delete this file?" description={`${deleting.fileName} will be removed from this record. The audit log keeps a record of the deletion.`}>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" isLoading={remove.isPending} onPress={() => remove.mutate(deleting)}>Delete file</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function EditAttachmentDialog({ file, onClose, onSaved }: { file: CrmAttachment; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(file.fileName);
  const [description, setDescription] = useState(file.description ?? "");
  const save = useMutation({ mutationFn: () => updateAttachment(file.id, { displayName: name.trim(), description: description.trim() }), onSuccess: onSaved });
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title="Rename file" description={`Uploaded as ${file.originalFileName}. The file's type cannot change.`}>
      <div className="flex flex-col gap-4">
        {save.isError && <p role="alert" className="text-sm text-danger">{errorMessage(save.error, "The file could not be updated.")}</p>}
        <TextField label="File name" isRequired value={name} onChange={setName} />
        <TextArea label="Description" value={description} onChange={setDescription} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={save.isPending} isDisabled={!name.trim()} onPress={() => save.mutate()}>Save</Button>
        </div>
      </div>
    </Dialog>
  );
}
