import { prepareCompanyImage, readCompanyImage, removeCompanyImage, setCompanyImage } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, fail, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// The company's logo or authorised signatory's signature: /api/settings/company/images/{logo|signature}.
const KINDS = new Set(["logo", "signature"]);
type Params = { params: Promise<{ kind: string }> };

export async function GET(request: Request, { params }: Params) {
  const { kind } = await params;
  if (!KINDS.has(kind)) return fail("Not found.", 404);
  return workspaceRoute(request, { action: "organization.company.image" }, async ({ client, session }) => {
    const image = await readCompanyImage(client, session.organizationId, kind as "logo" | "signature");
    if (!image) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
    return new Response(new Uint8Array(image.body), {
      status: 200,
      headers: { "Content-Type": image.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" },
    });
  });
}

// Multipart: file (PNG, JPEG or WebP, up to 1 MB).
export async function POST(request: Request, { params }: Params) {
  const { kind } = await params;
  if (!KINDS.has(kind)) return fail("Not found.", 404);
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "organization.company.image.set" }, async ({ client, session }) => {
    const form = await request.formData().catch(() => {
      throw new HttpError(400, "Choose an image.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose an image.");
    const prepared = await prepareCompanyImage({ fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) }, process.env);
    return ok(await setCompanyImage(client, session, kind as "logo" | "signature", prepared), 201);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  const { kind } = await params;
  if (!KINDS.has(kind)) return fail("Not found.", 404);
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "organization.company.image.remove" }, async ({ client, session }) =>
    ok(await removeCompanyImage(client, session, kind as "logo" | "signature")));
}
