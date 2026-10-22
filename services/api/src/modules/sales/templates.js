// Message templates (Sales plan, Setup › Print & WhatsApp templates): the text a WhatsApp or email message for a document starts from.
// A template is plain text with {placeholders} filled from the document; without one, the built-in wording is used.
import { SalesError } from "./index.js";

export const TEMPLATE_KINDS = Object.freeze([
  { kind: "quotation", label: "Quotation", placeholders: ["name", "number", "date", "total", "valid_until", "company"] },
  { kind: "order_confirmation", label: "Order confirmation", placeholders: ["name", "number", "date", "total", "po_number", "company"] },
  { kind: "invoice", label: "Invoice", placeholders: ["name", "number", "date", "total", "due_date", "balance", "company"] },
  { kind: "credit_note", label: "Credit note", placeholders: ["name", "number", "date", "total", "company"] },
  { kind: "debit_note", label: "Debit note", placeholders: ["name", "number", "date", "total", "company"] },
  { kind: "receipt", label: "Payment receipt", placeholders: ["name", "number", "date", "total", "bills", "company"] },
  { kind: "payment_reminder", label: "Payment reminder", placeholders: ["name", "total", "overdue", "oldest_due", "bills", "company"] },
]);
const CHANNELS = Object.freeze(["whatsapp", "email"]);
const can = (context, permission) => context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission);

export async function listMessageTemplates(client, context) {
  if (!can(context, "sales.settings.manage") && !can(context, "sales.view")) throw new SalesError(403, "You do not have permission to see message templates.", "PERMISSION_DENIED");
  const rows = (await client.query("SELECT document_kind, channel, body, updated_at FROM tenant.sales_message_templates WHERE organization_id = $1", [context.organizationId])).rows;
  return { kinds: TEMPLATE_KINDS, templates: rows.map((row) => ({ kind: row.document_kind, channel: row.channel, body: row.body, updatedAt: row.updated_at })) };
}

// input: { kind, channel, body } — an empty body goes back to the built-in wording.
export async function saveMessageTemplate(client, context, input = {}) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to change message templates.", "PERMISSION_DENIED");
  const definition = TEMPLATE_KINDS.find((entry) => entry.kind === input.kind);
  if (!definition || !CHANNELS.includes(input.channel)) throw new SalesError(400, "Choose the document and the channel.", "SALES_TEMPLATE_INVALID");
  const body = String(input.body ?? "").trim().slice(0, 2000);
  if (!body) {
    await client.query("DELETE FROM tenant.sales_message_templates WHERE organization_id = $1 AND document_kind = $2 AND channel = $3", [context.organizationId, input.kind, input.channel]);
    return { kind: input.kind, channel: input.channel, body: null };
  }
  const unknown = [...body.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]).filter((name) => !definition.placeholders.includes(name));
  if (unknown.length) throw new SalesError(400, `Unknown placeholder ${unknown.map((name) => `{${name}}`).join(", ")}. Use ${definition.placeholders.map((name) => `{${name}}`).join(", ")}.`, "SALES_TEMPLATE_INVALID", { field: "body" });
  await client.query(
    `INSERT INTO tenant.sales_message_templates (organization_id, document_kind, channel, body, updated_by) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (organization_id, document_kind, channel) DO UPDATE SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = clock_timestamp()`,
    [context.organizationId, input.kind, input.channel, body, context.userId ?? null]);
  return { kind: input.kind, channel: input.channel, body };
}

// The message for a document: the company's template filled in, else `fallback`.
export async function messageFromTemplate(client, organizationId, kind, channel, values, fallback) {
  const row = (await client.query("SELECT body FROM tenant.sales_message_templates WHERE organization_id = $1 AND document_kind = $2 AND channel = $3",
    [organizationId, kind, channel])).rows[0];
  if (!row) return fallback;
  return row.body.replace(/\{([a-z_]+)\}/g, (_match, name) => (values[name] ?? "").toString());
}
