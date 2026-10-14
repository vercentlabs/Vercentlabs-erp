"use client";

import { Dialog } from "@vercentlabs/design-system";

import { attachmentDownloadUrl, type CrmAttachment } from "@/features/crm/notes/api/notes-api";

// A file opened in place (an image, or a PDF in a frame), with its download link. Read through the API, which checks access each time.
export function FilePreviewDialog({ file, onClose }: { file: Pick<CrmAttachment, "id" | "fileName" | "preview">; onClose: () => void }) {
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onClose(); }} title={file.fileName} size="lg">
      <div className="flex flex-col gap-3">
        {file.preview === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, authorized file, not a static asset
          <img src={attachmentDownloadUrl(file.id, true)} alt={file.fileName} className="max-h-[70vh] w-full object-contain" />
        ) : (
          <iframe src={attachmentDownloadUrl(file.id, true)} title={file.fileName} className="h-[70vh] w-full rounded border border-border bg-white" />
        )}
        <div className="flex justify-end">
          <a href={attachmentDownloadUrl(file.id)} className="text-sm font-medium text-brand underline">Download</a>
        </div>
      </div>
    </Dialog>
  );
}
