import { listProductFiles, prepareProductFileUpload, uploadProductFile } from "@vercentlabs/api/products";
import { PRODUCT_PERMISSIONS } from "@vercentlabs/permissions";

import { type ProductRouteParams, productRead, productUpload, readFile } from "@/features/items/server/item-http";

export async function GET(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productRead(request, PRODUCT_PERMISSIONS.view, async (client, context) => ({ files: await listProductFiles(client, context, id) }));
}

// Multipart: file, makePrimaryImage. The type is checked from the bytes.
export async function POST(request: Request, { params }: ProductRouteParams) {
  const { id } = await params;
  return productUpload(request, PRODUCT_PERMISSIONS.edit, async (client, context) => {
    const upload = await readFile(request);
    const prepared = await prepareProductFileUpload({ fileName: upload.fileName, bytes: upload.bytes }, process.env);
    return { file: await uploadProductFile(client, context, id, { prepared, makePrimaryImage: upload.field("makePrimaryImage") === "true" }) };
  }, 201);
}
