import { renderSharedPurchaseOrderPdf } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";

// The supplier's PDF of a purchase order shared on WhatsApp (no sign-in: the token in the link is the credential). An unknown or revoked
// link is not found.
export async function GET(_request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  const pdf = await ingressTransaction((client) => renderSharedPurchaseOrderPdf(client, token)).catch(() => null);
  if (!pdf) return new Response("This link is not valid.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new Response(new Uint8Array(pdf.body), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.fileName}"`, "Content-Length": String(pdf.body.length),
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
    },
  });
}
