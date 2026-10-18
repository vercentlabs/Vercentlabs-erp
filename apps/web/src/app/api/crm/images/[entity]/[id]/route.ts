import { prepareRecordImage, readRecordImage, removeRecordImage, setRecordImage } from "@vercentlabs/api/crm";

import { HttpError, fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// A company's logo or a contact's photo (CRM plan 5.5): /api/crm/images/{accounts|contacts}/{id}.
const TYPES: Record<string, "party" | "contact"> = { accounts: "party", contacts: "contact" };
type Params = { params: Promise<{ entity: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const image = await readRecordImage(client, crmContext(session, snapshot), TYPES[entity], id);
    if (!image) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
    return new Response(new Uint8Array(image.body), {
      status: 200,
      headers: { "Content-Type": image.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  });
}

// Multipart: file (JPEG, PNG or WebP, up to 2 MB).
export async function POST(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Choose an image.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose an image.");
    const prepared = await prepareRecordImage({ fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, process.env);
    return ok(await setRecordImage(client, crmContext(session, snapshot), TYPES[entity], id, { prepared }), 201);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { entity, id } = await params;
  if (!TYPES[entity]) return fail("Not found.", 404);
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await removeRecordImage(client, crmContext(session, snapshot), TYPES[entity], id)));
}
