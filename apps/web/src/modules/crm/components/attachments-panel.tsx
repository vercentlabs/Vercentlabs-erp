"use client";

import { useEffect, useRef, useState } from "react";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, FormField, StatePanel, StatusBadge } from "@/shared/design";
import kernelStyles from "@/shared/design/experience-kernel.module.css";
import styles from "./timeline-panel.module.css";

type AttachmentItem = {
  id: string;
  logicalId: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  lifecycleStatus: string;
  scanStatus: string;
  uploadedBy?: string | null;
  createdAt: string;
};

type VersionItem = {
  id: string;
  version: number;
  isCurrent: boolean;
  fileName: string;
  sizeBytes: number;
  lifecycleStatus: string;
  scanStatus: string;
  createdAt: string;
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}
function formatSize(bytes: number) {
  if (!Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
// Honest upload/scan state per §27: pending/scanning/available/rejected —
// derived from the real lifecycle_status/scan_status columns, never a
// fabricated "uploaded" label for a file still being scanned.
function statusLabel(item: AttachmentItem) {
  if (item.lifecycleStatus === "quarantined") return "Scanning";
  if (item.lifecycleStatus === "rejected") return "Rejected";
  if (item.lifecycleStatus === "clean" && item.scanStatus === "clean") return "Available";
  if (item.lifecycleStatus === "clean" && item.scanStatus === "not_applicable") return "Available";
  return "Pending";
}
function statusTone(item: AttachmentItem) {
  const label = statusLabel(item);
  if (label === "Available") return "success" as const;
  if (label === "Rejected") return "danger" as const;
  return "neutral" as const;
}

// F017 closeout — the shared rendering surface for the canonical
// attachment domain (attachments-operations.js), consumed by Account/
// Contact/Opportunity 360 (none of the three had any Files UI before
// this). Lead keeps its own existing, already-tested inline Attachments
// tab — same domain module underneath either way.
export default function AttachmentsPanel({
  listEndpoint,
  canManage,
}: {
  listEndpoint: string;
  canManage: boolean;
}) {
  const [attachments, setAttachments] = useState<AttachmentItem[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // Version history is fetched on demand per logical file, not eagerly for
  // every row — keyed by logicalId; null = not yet loaded, [] = loaded/empty.
  const [versionsByLogicalId, setVersionsByLogicalId] = useState<Record<string, VersionItem[] | null>>({});
  const [replacingId, setReplacingId] = useState<string | null>(null);
  // Bumped after every mutation to re-trigger the fetch effect below — same
  // shape as timeline-panel.tsx's load-inside-effect (avoids react-hooks/
  // set-state-in-effect, which flags calling a component-scope async
  // setState function directly inside a useEffect body).
  const [refreshKey, setRefreshKey] = useState(0);
  function reload() {
    setRefreshKey((key) => key + 1);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const result = await requestJson<{ attachments?: AttachmentItem[] }>(listEndpoint);
      if (cancelled) return;
      if (!result.ok) {
        setLoadError(result.message || "Files could not be loaded.");
        setAttachments([]);
        return;
      }
      setAttachments(result.attachments || []);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [listEndpoint, refreshKey]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(listEndpoint, { method: "POST", credentials: "same-origin", body: form });
    const result = (await response.json().catch(() => ({ ok: false }))) as { ok?: boolean; message?: string };
    setUploading(false);
    if (!result.ok) {
      setMessage(result.message || "File could not be uploaded.");
      return;
    }
    if (fileInput.current) fileInput.current.value = "";
    reload();
  }

  async function remove(id: string) {
    const result = await requestJson(`${listEndpoint}/${id}`, { method: "DELETE" });
    if (!result.ok) {
      setMessage(result.message || "File could not be removed.");
      return;
    }
    reload();
  }

  // F017 §CRM-VNEXT-053: "replace this file" reuses the SAME logical
  // identity (via replacesLogicalId) rather than creating an unrelated
  // attachment — the prior version is preserved, never overwritten.
  async function replace(item: AttachmentItem, file: File) {
    setReplacingId(item.id);
    setMessage("");
    const form = new FormData();
    form.append("file", file);
    form.append("replacesLogicalId", item.logicalId);
    const response = await fetch(listEndpoint, { method: "POST", credentials: "same-origin", body: form });
    const result = (await response.json().catch(() => ({ ok: false }))) as { ok?: boolean; message?: string };
    setReplacingId(null);
    if (!result.ok) {
      setMessage(result.message || "Replacement file could not be uploaded.");
      return;
    }
    setVersionsByLogicalId((prev) => ({ ...prev, [item.logicalId]: null }));
    reload();
  }

  async function toggleVersions(item: AttachmentItem) {
    const already = versionsByLogicalId[item.logicalId];
    if (already !== undefined) {
      setVersionsByLogicalId((prev) => {
        const next = { ...prev };
        delete next[item.logicalId];
        return next;
      });
      return;
    }
    const result = await requestJson<{ versions?: VersionItem[] }>(`${listEndpoint}/${item.logicalId}/versions`);
    setVersionsByLogicalId((prev) => ({ ...prev, [item.logicalId]: result.ok ? result.versions || [] : [] }));
  }

  return (
    <div>
      {canManage ? (
        <form className="crm-suite-form" onSubmit={upload}>
          <FormField label="Attach file" htmlFor="crm-attachment-file">
            <input ref={fileInput} id="crm-attachment-file" type="file" name="file" required />
          </FormField>
          <ActionButton type="submit" tone="primary" busy={uploading}>
            {uploading ? "Uploading…" : "Upload file"}
          </ActionButton>
        </form>
      ) : null}
      {message ? <p role="status">{message}</p> : null}

      {attachments === null ? <StatePanel title="Loading files…" /> : null}
      {attachments && loadError && !attachments.length ? <StatePanel title="Files could not be loaded." description={loadError} /> : null}
      {attachments && !attachments.length && !loadError ? <StatePanel title="No files attached yet." /> : null}
      {attachments && attachments.length ? (
        <ul className={styles.list}>
          {attachments.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemHeading}>
                <strong>{item.fileName}</strong>
                <StatusBadge tone={statusTone(item)}>{statusLabel(item)}</StatusBadge>
                {item.version > 1 ? <StatusBadge tone="neutral">v{item.version}</StatusBadge> : null}
              </div>
              <span className={styles.itemMeta}>
                {formatSize(item.sizeBytes)} · {formatDate(item.createdAt)}
              </span>
              <div>
                {statusLabel(item) === "Available" ? (
                  <a href={`${listEndpoint}/${item.id}`}>Download</a>
                ) : null}
                {canManage ? (
                  <ActionButton type="button" tone="quiet" onClick={() => void remove(item.id)}>Remove</ActionButton>
                ) : null}
                <ActionButton type="button" tone="quiet" onClick={() => void toggleVersions(item)}>
                  {versionsByLogicalId[item.logicalId] !== undefined ? "Hide versions" : "Version history"}
                </ActionButton>
                {canManage ? (
                  <label className={styles.itemMeta}>
                    {replacingId === item.id ? "Uploading replacement…" : "Replace file"}
                    <input
                      type="file"
                      className={kernelStyles.visuallyHidden}
                      disabled={replacingId === item.id}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void replace(item, file);
                      }}
                    />
                  </label>
                ) : null}
              </div>
              {versionsByLogicalId[item.logicalId] ? (
                <ul className={styles.list}>
                  {versionsByLogicalId[item.logicalId]!.map((version) => (
                    <li key={version.id} className={styles.item}>
                      <span className={styles.itemMeta}>
                        v{version.version}
                        {version.isCurrent ? " (current)" : ""} · {version.fileName} · {formatSize(version.sizeBytes)} · {formatDate(version.createdAt)}
                      </span>
                      {version.lifecycleStatus === "clean" && (version.scanStatus === "clean" || version.scanStatus === "not_applicable") ? (
                        <a href={`${listEndpoint}/${version.id}`}>Download</a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {versionsByLogicalId[item.logicalId] && versionsByLogicalId[item.logicalId]!.length === 0 ? (
                <span className={styles.itemMeta}>No version history available.</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
