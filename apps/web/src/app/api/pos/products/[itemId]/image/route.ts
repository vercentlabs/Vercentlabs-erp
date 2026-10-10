import { readProductFile } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";

type Params = { params: Promise<{ itemId: string }> };

// A product's primary image for the POS product tiles. Only the image the Item Master marks as the product's picture, to anyone with POS
// access (a cashier needs no Products permission to see what they sell); never any other file of the product.
export async function GET(request: Request, { params }: Params) {
  const { itemId } = await params;
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.view" }, async ({ client, session }) => {
    if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new HttpError(404, "Image not found.");
    const item = (await client.query(`SELECT image_attachment_id FROM tenant.items WHERE organization_id = $1 AND id = $2`, [session.organizationId, itemId])).rows[0];
    if (!item?.image_attachment_id) throw new HttpError(404, "Image not found.");
    const context = salesContext(session);
    const file = await readProductFile(client, { ...context, permissions: [...context.permissions, PRODUCT_PERMISSIONS.view] }, itemId, item.image_attachment_id);
    if (!file.mimeType.startsWith("image/")) throw new HttpError(404, "Image not found.");
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; sandbox",
      },
    });
  });
}
