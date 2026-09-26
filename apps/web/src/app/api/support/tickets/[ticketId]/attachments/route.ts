import { addAttachment, addMyAttachment, assertSameOriginOrMobile, prepareFileUpload } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { toWire } from "@/core/wire";
import { requireSupportAccess, supportContext } from "@/features/support/shared/support-context";

// Ticket attachment upload (multipart). The Shared Platform pipeline
// validates and scans the file OUTSIDE the transaction; the Support domain
// then checks the ticket and stores it. Staff need support.communication.manage;
// a portal customer (selfService=1) may attach only to their own tickets and
// never as a private note.
export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { ticketId } = await context.params;
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "A multipart file upload is required.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "A file is required.");
    const selfService = form.get("selfService") === "1";
    const prepared = await prepareFileUpload({ fileName: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()), maximumBytes: 25 * 1024 * 1024 }, process.env);
    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireSupportAccess(client, session, selfService ? "" : "support.view", { mutation: true });
      const domain = supportContext(session);
      return selfService
        ? addMyAttachment(client, domain, ticketId, { prepared })
        : addAttachment(client, domain, ticketId, { prepared, privateNote: form.get("privateNote") === "1" });
    });
    return ok(toWire({ record }) as Record<string, unknown>, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
