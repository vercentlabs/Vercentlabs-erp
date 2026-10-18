import { recordMailingOpen } from "@vercentlabs/api/crm";

import { ingressTransaction } from "@/core/db";

// The open pixel of a campaign email (CRM plan 5.8): counts the first open, answers a transparent 1×1 GIF whatever happens.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await ingressTransaction((client) => recordMailingOpen(client, token)).catch(() => undefined);
  return new Response(new Uint8Array(GIF), { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store, private", "Content-Length": String(GIF.length) } });
}
