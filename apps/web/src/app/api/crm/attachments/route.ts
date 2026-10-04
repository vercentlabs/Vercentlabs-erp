import { listAttachments, prepareAttachmentUpload, uploadAttachment } from "@vercentlabs/api/crm";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { relatedRecordFromUrl } from "@/features/crm/notes/server/content-http";

// The files on one record: ?relatedType&relatedId&kind&sortBy=uploadedAt|name|type|uploadedBy&search&noteId
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const { relatedType, relatedId } = relatedRecordFromUrl(url);
    const attachments = await listAttachments(client, crmContext(session), relatedType, relatedId, {
      kind: url.searchParams.get("kind"),
      sortBy: url.searchParams.get("sortBy") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      noteId: url.searchParams.get("noteId"),
    });
    return ok({ attachments });
  });
}

function text(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// Multipart: file, relatedType, relatedId, description?, noteId?, idempotencyKey?
// The file's type, size and content are checked from its bytes, never from the browser's claims.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Choose a file to upload.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file to upload.");
    const relatedType = text(form, "relatedType");
    const relatedId = text(form, "relatedId");
    if (!relatedType || !relatedId) throw new HttpError(400, "relatedType and relatedId are required.");
    const prepared = await prepareAttachmentUpload({ fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, process.env);
    const attachment = await uploadAttachment(client, crmContext(session), relatedType, relatedId, {
      prepared,
      description: text(form, "description"),
      noteId: text(form, "noteId"),
      idempotencyKey: text(form, "idempotencyKey"),
    });
    return ok({ attachment }, 201);
  });
}
