"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Download, File, History, RefreshCw, Upload } from "lucide-react";
import { Button, Dialog, IconButton, IconLinkButton, PermissionState } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getCrmOptions } from "./crm-options-api";
import {
  attachmentDownloadHref,
  AttachmentApiError,
  deleteAttachment,
  formatFileSize,
  listAttachmentVersions,
  listAttachments,
  uploadAttachment,
  type CrmAttachment,
  type CrmAttachmentEntityType,
} from "./attachments-api";

const dateFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// F017 Attachments, composed into a record 360 the same way Notes is —
// not a standalone global screen. Governed entirely by
// attachments-operations.js + document-engine + attachment-security:
// this component never decides what's safe to upload/download, it only
// renders what the backend already validated/scanned/authorized.
// Rejected/quarantined bytes never reach this UI at all — the upload
// route validates+scans synchronously BEFORE any row is ever created, so
// there is no "pending scan" row to poll for; a rejected upload just
// surfaces as an error and nothing is persisted.
export function CrmAttachmentPanel({ entityType, entityId }: { entityType: CrmAttachmentEntityType; entityId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [versionsFor, setVersionsFor] = useState<CrmAttachment | null>(null);

  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "attachments", entityType, entityId),
    queryFn: () => listAttachments(entityType, entityId),
  });
  const rows = query.data?.rows ?? [];

  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "options"), queryFn: getCrmOptions });
  const userNames = useMemo(() => {
    const users = optionsQuery.data?.options?.users ?? [];
    return new Map(users.map((row) => [String(row.id), String(row.fullName || row.name || row.id)]));
  }, [optionsQuery.data]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "attachments", entityType, entityId) });
  }
  function handleError(err: unknown) {
    setError(err instanceof AttachmentApiError ? err.message : "This action could not be completed.");
  }

  const uploadMutation = useMutation({
    mutationFn: ({ file, replacesLogicalId }: { file: File; replacesLogicalId?: string }) => uploadAttachment(entityType, entityId, file, replacesLogicalId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  const deleteMutation = useMutation({
    mutationFn: (row: CrmAttachment) => deleteAttachment(entityType, entityId, row.id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: handleError,
  });

  function handleFileChosen(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    uploadMutation.mutate({ file, replacesLogicalId: replaceTarget || undefined });
    setReplaceTarget(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  if (query.isError && query.error instanceof AttachmentApiError && query.error.status === 403) {
    return <PermissionState title="You don't have access to attachments on this record" />;
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(event) => handleFileChosen(event.target.files)}
      />
      {error && (
        <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading attachments…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-muted">No attachments.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2">
              <File className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">{row.fileName}</p>
                <p className="text-xs text-text-muted">
                  {formatFileSize(row.sizeBytes)} · {row.uploadedBy ? userNames.get(row.uploadedBy) || "Someone" : "Unknown"} · {dateFormatter.format(new Date(row.createdAt))}
                  {row.version > 1 ? ` · v${row.version}` : ""}
                </p>
              </div>
              <IconButton aria-label={`Version history for ${row.fileName}`} variant="ghost" size="compact" onPress={() => setVersionsFor(row)}>
                <History className="size-4" aria-hidden="true" />
              </IconButton>
              <IconButton
                aria-label={`Upload a new version of ${row.fileName}`}
                variant="ghost"
                size="compact"
                onPress={() => {
                  setReplaceTarget(row.logicalId);
                  fileInputRef.current?.click();
                }}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
              </IconButton>
              <IconLinkButton aria-label={`Download ${row.fileName}`} size="compact" href={attachmentDownloadHref(entityType, entityId, row.id)}>
                <Download className="size-4" aria-hidden="true" />
              </IconLinkButton>
              <IconButton aria-label={`Delete ${row.fileName}`} variant="danger" size="compact" onPress={() => deleteMutation.mutate(row)} isDisabled={deleteMutation.isPending}>
                <Archive className="size-4" aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="secondary"
        size="compact"
        className="self-start"
        isLoading={uploadMutation.isPending && !replaceTarget}
        onPress={() => {
          setReplaceTarget(null);
          fileInputRef.current?.click();
        }}
      >
        <Upload className="size-4" aria-hidden="true" />
        Upload file
      </Button>

      <VersionHistoryDialog
        entityType={entityType}
        entityId={entityId}
        attachment={versionsFor}
        onClose={() => setVersionsFor(null)}
        userNames={userNames}
      />
    </div>
  );
}

function VersionHistoryDialog({
  entityType,
  entityId,
  attachment,
  onClose,
  userNames,
}: {
  entityType: CrmAttachmentEntityType;
  entityId: string;
  attachment: CrmAttachment | null;
  onClose: () => void;
  userNames: Map<string, string>;
}) {
  const workspace = useWorkspaceContext();
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "attachment-versions", entityType, entityId, attachment?.logicalId ?? ""),
    queryFn: () => listAttachmentVersions(entityType, entityId, attachment!.logicalId),
    enabled: Boolean(attachment),
  });
  const rows = query.data?.rows ?? [];

  return (
    <Dialog isOpen={Boolean(attachment)} onOpenChange={(open) => !open && onClose()} title={attachment ? `Versions of ${attachment.fileName}` : "Versions"}>
      <div className="flex flex-col gap-2">
        {query.isLoading ? (
          <p className="text-sm text-text-secondary">Loading versions…</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <div className="flex flex-col">
                  <span className="text-sm text-text">
                    v{row.version}
                    {row.isCurrent ? " (current)" : ""}
                  </span>
                  <span className="text-xs text-text-muted">
                    {formatFileSize(row.sizeBytes)} · {row.uploadedBy ? userNames.get(row.uploadedBy) || "Someone" : "Unknown"} · {dateFormatter.format(new Date(row.createdAt))}
                  </span>
                </div>
                <IconLinkButton aria-label={`Download v${row.version}`} size="compact" href={attachmentDownloadHref(entityType, entityId, row.id)}>
                  <Download className="size-4" aria-hidden="true" />
                </IconLinkButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
