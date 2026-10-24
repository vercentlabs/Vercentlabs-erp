import { prepareFileUpload, uploadInvoiceOnSupplierPage } from "@vercentlabs/api";

import { supplierAnswer } from "../../answer";

// The supplier's invoice for the order (multipart: file, invoiceNumber, invoiceDate, total?, name?). The file is checked before the transaction.
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const field = (name: string) => { const value = form?.get(name); return typeof value === "string" ? value : ""; };
  if (!(file instanceof File)) return Response.json({ ok: false, message: "Attach your invoice (PDF or a photo)." }, { status: 400 });
  if (file.size > 10 * 1024 * 1024) return Response.json({ ok: false, message: "The file is larger than 10 MB." }, { status: 413 });
  let prepared: unknown;
  try {
    prepared = await prepareFileUpload({ fileName: file.name.slice(0, 200), mimeType: file.type || "application/pdf", bytes: Buffer.from(await file.arrayBuffer()), maximumBytes: 10 * 1024 * 1024,
      allowedTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"] });
  } catch (error) {
    return Response.json({ ok: false, message: error instanceof Error ? error.message : "The file could not be read." }, { status: 400 });
  }
  return supplierAnswer(request, token, "Your invoice could not be sent. Try again.", (client) =>
    uploadInvoiceOnSupplierPage(client, token, { invoiceNumber: field("invoiceNumber"), invoiceDate: field("invoiceDate"), total: field("total"), name: field("name") }, prepared));
}
