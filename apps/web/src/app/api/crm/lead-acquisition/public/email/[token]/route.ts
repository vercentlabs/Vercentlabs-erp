import { ingestLeadAcquisitionWebhook } from "@vercentlabs/api";

import { crmLeadAcquisitionErrorResponse } from "@/lib/crm-lead-acquisition-route";
import { query, tenantTransaction } from "@/lib/db";
import { HttpError, ok } from "@/lib/http";
import { readRequestBytes } from "@/lib/security";

type Params = { params: Promise<{ token: string }> };
function text(value: unknown, max = 20_000) { return String(value ?? "").trim().slice(0, max); }
function sender(input: Record<string, unknown>) {
  const from = input.from;
  if (from && typeof from === "object" && !Array.isArray(from)) {
    const row = from as Record<string, unknown>;
    return { email: text(row.email || row.address, 320), name: text(row.name, 240) };
  }
  return {
    email: text(input.fromEmail || input.from_email || input.senderEmail || input.email || from, 320),
    name: text(input.fromName || input.from_name || input.senderName, 240),
  };
}
function names(name: string, email: string) {
  const fallback = email.split("@")[0]?.replace(/[._-]+/g, " ") || "Email lead";
  const pieces = (name || fallback).trim().split(/\s+/).filter(Boolean);
  return { firstName: pieces[0] || "Email", lastName: pieces.slice(1).join(" ") || null };
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const requiredSecret = process.env.CRM_INBOUND_EMAIL_SECRET || "";
    if (requiredSecret && request.headers.get("x-vercentlabs-email-secret") !== requiredSecret)
      throw new HttpError(401, "Inbound email secret is invalid.");
    const connections = await query<{
      organization_id: string; connection_id: string; provider: string; created_by: string;
    }>("SELECT * FROM tenant.crm_public_acquisition_connection($1)", [token]);
    const connection = connections[0];
    if (!connection || connection.provider !== "inbound_email")
      throw new HttpError(404, "Inbound-email connection not found.");
    const bytes = await readRequestBytes(request, 1_000_000);
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let input: Record<string, unknown>;
    try { input = JSON.parse(raw) as Record<string, unknown>; }
    catch { throw new HttpError(400, "Inbound email payload must be JSON."); }
    const messageId = text(input.messageId || input.message_id || input.eventId || input.event_id || input.id, 240);
    if (!messageId) throw new HttpError(400, "Inbound email message ID is required.");
    const from = sender(input);
    if (!from.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.email))
      throw new HttpError(400, "Inbound email sender address is required.");
    const split = names(from.name, from.email);
    const subject = text(input.subject, 500);
    const body = text(input.text || input.textBody || input.text_body || input.body || input.html, 20_000);
    const recipients = Array.isArray(input.to)
      ? input.to.map((value) => text(value, 320)).filter(Boolean)
      : text(input.to || input.toEmail || input.to_email, 320)
        ? [text(input.to || input.toEmail || input.to_email, 320)]
        : [];
    const context = {
      organizationId: connection.organization_id,
      userId: String(connection.created_by || "00000000-0000-4000-8000-000000000000"),
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
      permissions: ["crm.records.view_all", "crm.leads.manage"],
      roleSlugs: [] as string[],
    };
    const result = await tenantTransaction(connection.organization_id, async (client) => {
      const ingested = await ingestLeadAcquisitionWebhook(client, context, connection.connection_id, "inbound_email", {
        eventId: messageId,
        eventType: "email.received",
        lead: {
          firstName: split.firstName,
          lastName: split.lastName,
          email: from.email,
          companyName: text(input.companyName || input.company_name, 240) || null,
          jobTitle: text(input.jobTitle || input.job_title, 160) || null,
          productInterest: subject || body.slice(0, 500),
          customData: { inboundEmailSubject: subject },
        },
        attribution: { channel: "email", subject },
      });
      const leadId = String(ingested.leadId || "");
      if (leadId) {
        await client.query(
          `INSERT INTO tenant.crm_communications(
             organization_id,channel,direction,lead_id,provider,provider_message_id,
             subject,body,from_address,to_addresses,status,occurred_at,metadata,created_by,updated_by
           ) VALUES($1,'email','inbound',$2,'inbound_email',$3,$4,$5,$6,$7::text[],'received',
                    COALESCE($8::timestamptz,now()),$9::jsonb,$10,$10)
           ON CONFLICT(organization_id,provider,provider_message_id) DO NOTHING`,
          [context.organizationId, leadId, messageId, subject || null, body || null, from.email,
           recipients, input.receivedAt || input.received_at || null,
           JSON.stringify({ source: "inbound_email", rawProvider: input.provider || null }), context.userId],
        );
      }
      return ingested;
    });
    return ok({ accepted: true, result }, 201);
  } catch (error) { return crmLeadAcquisitionErrorResponse(error); }
}
