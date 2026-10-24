// A supplier's link to a purchase order (Procurement plan Phase 3; the supplier's page, report H5): shared on WhatsApp, opened without
// signing in. The token is the only credential — 24 random bytes, kept hashed for lookup and encrypted so the same link is given every
// time; revoking it ends it. The link opens the supplier's page for the order as currently confirmed (a draft is not shared), where they
// confirm it, propose a date, download the PDF and send their invoice.
import { createHash } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";
import { whatsappNumber } from "@vercentlabs/shared-types";

import { loadPurchaseOrder, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError } from "./constants.js";
import { supplierLinkToken, supplierPageUrl } from "./supplier-page.js";

const TOKEN = /^[0-9a-f]{48}$/;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
// What the link acts with: reading and printing purchase orders, nothing else.
const linkContext = (organizationId) => ({ organizationId, userId: null, roleSlugs: [], permissions: ["procurement.view", "procurement.po.view", "procurement.po.view_all"] });

// sharePurchaseOrderLink: the link, and a WhatsApp message to the supplier's contact (or the number given) with it.
export async function sharePurchaseOrderLink(client, context, orderId, { phone = null } = {}, env = process.env) {
  requirePoPermission(context, PO_PERMISSIONS.send, "You do not have permission to send purchase orders.");
  const order = await loadPurchaseOrder(client, context, orderId);
  if (order.status === "draft" || order.status === "cancelled") throw new PurchaseOrderError(409, "Confirm the order before sending it to the supplier.", "PURCHASE_ORDER_NOT_SHAREABLE");
  const token = await supplierLinkToken(client, context, "purchase_order", order.id, env);
  const url = supplierPageUrl(token, env);
  const contact = (await client.query(
    `SELECT COALESCE(contact.mobile, contact.phone) AS phone FROM tenant.procurement_supplier_contacts link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id
        AND contact.id = link.contact_id WHERE link.organization_id = $1 AND link.supplier_id = $2 AND COALESCE(contact.mobile, contact.phone) IS NOT NULL
      ORDER BY (link.contact_id = $3) DESC, link.is_primary DESC NULLS LAST LIMIT 1`, [context.organizationId, order.supplier_id, order.supplier_contact_id])).rows[0];
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.name ?? "";
  const own = contact?.phone ? null : (await client.query("SELECT primary_phone FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2", [context.organizationId, order.supplier_id])).rows[0]?.primary_phone;
  const number = whatsappNumber(phone ?? contact?.phone ?? own) ?? "";
  const body = `Purchase order ${order.purchase_order_number} from ${company}${order.expected_delivery_date ? `, needed by ${String(order.expected_delivery_date).slice(0, 10)}` : ""}. Please confirm: ${url}`;
  return { url, body, phone: number || null, whatsapp: `https://wa.me/${number}?text=${encodeURIComponent(body)}` };
}

export async function revokePurchaseOrderLink(client, context, orderId) {
  requirePoPermission(context, PO_PERMISSIONS.send, "You do not have permission to send purchase orders.");
  const order = await loadPurchaseOrder(client, context, orderId);
  const result = await client.query("UPDATE tenant.procurement_share_links SET revoked_at = now() WHERE organization_id = $1 AND document_type = 'purchase_order' AND document_id = $2 AND revoked_at IS NULL",
    [context.organizationId, order.id]);
  return { revoked: result.rowCount > 0 };
}

// The PDF behind a link (no session: the token is the credential); null for an unknown or revoked link, or a company without Procurement.
export async function renderSharedPurchaseOrderPdf(client, token) {
  if (!TOKEN.test(String(token ?? ""))) return null;
  const found = (await client.query("SELECT * FROM tenant.procurement_resolve_document_link($1)", [hash(token)])).rows[0];
  if (!found) return null;
  await setTenantContext(client, found.organization_id);
  const enabled = (await client.query("SELECT 1 FROM public.organization_modules WHERE organization_id = $1 AND module_key = 'procurement' AND status = 'enabled'", [found.organization_id])).rows[0];
  if (!enabled) return null;
  await client.query("UPDATE tenant.procurement_share_links SET view_count = view_count + 1, last_viewed_at = now() WHERE token_hash = $1", [hash(token)]);
  const { renderAuthorizedDocument } = await import("../../../orchestration/documents/registry.js");
  return renderAuthorizedDocument(client, linkContext(found.organization_id), "procurement.purchase_order", found.document_id);
}
