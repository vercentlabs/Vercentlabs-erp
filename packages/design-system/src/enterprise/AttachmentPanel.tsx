import { File, Download, Trash2 } from "lucide-react";
import { IconButton } from "../actions/IconButton.tsx";
import { IconLinkButton } from "../actions/IconLinkButton.tsx";
import { Button } from "../actions/Button.tsx";
import { cn } from "../utilities/cn.ts";

export interface Attachment {
  id: string;
  fileName: string;
  /** Pre-formatted size (e.g. "2.4 MB") — not a raw byte count. */
  fileSize: string;
  uploadedBy: string;
  /** Pre-formatted timestamp. */
  uploadedAt: string;
  downloadHref: string;
}

export interface AttachmentPanelProps {
  className?: string;
  attachments: Attachment[];
  onUpload?: () => void;
  onRemove?: (id: string) => void;
  /** Disables remove — e.g. the viewer lacks permission or the record is
   * locked. Uploads still shown, just not removable. */
  canRemove?: boolean;
}

export function AttachmentPanel({ className, attachments, onUpload, onRemove, canRemove = true }: AttachmentPanelProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {attachments.length === 0 ? (
        <p className="text-sm text-text-muted">No attachments</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 rounded-[var(--radius-control)] border border-border px-3 py-2"
            >
              <File className="size-4 shrink-0 text-text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text">{attachment.fileName}</p>
                <p className="text-xs text-text-muted">
                  {attachment.fileSize} · {attachment.uploadedBy} · {attachment.uploadedAt}
                </p>
              </div>
              <IconLinkButton aria-label={`Download ${attachment.fileName}`} size="compact" href={attachment.downloadHref}>
                <Download className="size-4" aria-hidden="true" />
              </IconLinkButton>
              {canRemove && onRemove && (
                <IconButton aria-label={`Remove ${attachment.fileName}`} variant="danger" size="compact" onPress={() => onRemove(attachment.id)}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
      {onUpload && (
        <Button variant="secondary" size="compact" onPress={onUpload} className="self-start">
          Upload file
        </Button>
      )}
    </div>
  );
}
