import { createNote, listNotes } from "@vercentlabs/api/crm";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, relatedRecordFromUrl } from "@/features/crm/notes/server/content-http";

// The notes on one record, pinned first then newest: ?relatedType&relatedId&search
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const { relatedType, relatedId } = relatedRecordFromUrl(url);
    return ok({ notes: await listNotes(client, crmContext(session), relatedType, relatedId, { search: url.searchParams.get("search") ?? undefined }) });
  });
}

// Body: { relatedType, relatedId, title?, body (rich text), isPinned?, visibility? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const body = await readBody(request);
    if (typeof body.relatedType !== "string" || typeof body.relatedId !== "string") throw new HttpError(400, "relatedType and relatedId are required.");
    return ok({ note: await createNote(client, crmContext(session), body.relatedType, body.relatedId, body) }, 201);
  });
}
