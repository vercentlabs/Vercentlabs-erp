import { getRelatedDocuments } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Related Documents for a record's Related tab: /api/related/purchase_order|opportunity|lead|item/<id>. The route is guarded by the module
// that owns the record; the record is then read through that module (its own permission and visibility), and each group of documents by
// its own permission.
const OWNER: Record<string, { module: string; permission?: string }> = {
  purchase_order: { module: "procurement", permission: "procurement.view" },
  opportunity: { module: "crm", permission: "crm.view" },
  lead: { module: "crm", permission: "crm.view" },
  item: { module: "stock", permission: "products.view" },
};

export async function GET(request: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await params;
  const owner = OWNER[type];
  if (!owner) return Response.json({ ok: false, message: "Unknown record type." }, { status: 404 });
  return workspaceRoute(request, owner, async ({ client, session }) =>
    ok({ related: await getRelatedDocuments(client, { organizationId: session.organizationId, userId: session.userId,
      permissions: session.permissions ?? [], roleSlugs: session.roleSlugs ?? [] }, type, id) }));
}
