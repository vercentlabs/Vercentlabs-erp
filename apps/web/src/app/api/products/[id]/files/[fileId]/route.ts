import { readProductFile, removeProductFile, setProductImage } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";
import { productWrite } from "@/features/items/server/item-http";

type Params = { params: Promise<{ id: string; fileId: string }> };

// The file itself: images are shown inline, everything else downloads.
export async function GET(request: Request, { params }: Params) {
  const { id, fileId } = await params;
  return workspaceRoute(request, { permission: PRODUCT_PERMISSIONS.view }, async ({ client, session }) => {
    const file = await readProductFile(client, salesContext(session), id, fileId);
    const image = file.mimeType.startsWith("image/");
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": image ? file.mimeType : "application/octet-stream",
        "Content-Disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
      },
    });
  });
}

// body: { primaryImage: true } makes this image the product's image.
export async function PATCH(request: Request, { params }: Params) {
  const { id, fileId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.edit, (client, context, body) => setProductImage(client, context, id, body.primaryImage === false ? null : fileId));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, fileId } = await params;
  return productWrite(request, PRODUCT_PERMISSIONS.edit, (client, context) => removeProductFile(client, context, id, fileId));
}
