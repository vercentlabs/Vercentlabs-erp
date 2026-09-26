import { addAttachment, addMyAttachment, assertSameOriginOrMobile, prepareFileUpload } from "@vercentlabs/api";

import { errorResponse, HttpError, ok } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";
import { toWire } from "@/core/wire";
import { workspaceRoute } from "@/core/workspace-route";
import { supportContext } from "@/features/support/shared/support-context";

// Ticket attachment upload (multipart). The caller is authenticated and the
// origin checked BEFORE any bytes are accepted; the Shared Platform pipeline
// then validates and scans the file OUTSIDE any transaction; workspaceRoute
// finally checks the Support module, permission (or portal self-service) and billing and the domain
// stores it. Staff need support.view (+ support.communication.manage in the
// domain); a portal customer (selfService=1) may attach only to their own
// tickets and never as a private note.
export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  let upload: { prepared: Awaited<ReturnType<typeof prepareFileUpload>>; selfService: boolean; privateNote: boolean };
  try {
    assertSameOriginOrMobile(request, process.env);
    await requireApiWorkspace();
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "A multipart file upload is required.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "A file is required.");
    const prepared = await prepareFileUpload({ fileName: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()), maximumBytes: 25 * 1024 * 1024 }, process.env);
    upload = { prepared, selfService: form.get("selfService") === "1", privateNote: form.get("privateNote") === "1" };
  } catch (error) {
    return errorResponse(error);
  }
  const action = "support.attachment.upload";
  const options = upload.selfService
    ? { module: "support", selfService: true, billingWrite: true, action }
    : { module: "support", permission: "support.view", billingWrite: true, action };
  return workspaceRoute(request, options, async ({ client, session }) => {
    const { ticketId } = await context.params;
    const domain = supportContext(session);
    const record = upload.selfService
      ? await addMyAttachment(client, domain, ticketId, { prepared: upload.prepared })
      : await addAttachment(client, domain, ticketId, { prepared: upload.prepared, privateNote: upload.privateNote });
    return ok(toWire({ record }) as Record<string, unknown>, 201);
  });
}
