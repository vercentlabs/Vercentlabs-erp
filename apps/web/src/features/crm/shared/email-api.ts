"use client";

// Browser client for email from records, templates and CRM email settings (CRM plan 4.1).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class EmailApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(EmailApiError, "body");

export type EmailEntity = "leads" | "opportunities" | "accounts" | "contacts";
export type EmailDraft = {
  to: string; subject: string; body: string; signature: string | null; reference: string | null; replyTo: string | null; refused: string | null; canSend: boolean;
  templates: Array<{ id: string; name: string }>;
};
export type RecordEmail = {
  id: string; direction: "inbound" | "outbound"; status: string; subject: string; body: string | null; from: string | null; fromName: string | null;
  to: string[]; cc: string[]; sentByName: string | null; createdAt: string; threaded: boolean;
};
export type EmailTemplate = { id: string; name: string; appliesTo: "any" | "lead" | "opportunity" | "party" | "contact"; subject: string; body: string; status: "active" | "inactive"; useCount: number; updatedAt: string; updatedByName: string | null;
  // the template in other languages (CRM plan 5.6), used for people who speak them
  translations?: Record<string, { subject: string; body: string }> };
export type EmailSettings = { replyToAddress: string | null; signature: string | null; placeholders: Array<{ key: string; label: string }> };

export const prepareEmail = (entity: EmailEntity, id: string, templateId?: string | null) =>
  request<{ draft: EmailDraft }>(`/api/crm/email/${entity}/${id}${templateId ? `?templateId=${templateId}` : ""}`).then((result) => result.draft);
export const sendEmail = (entity: EmailEntity, id: string, input: { to: string; cc?: string; subject: string; body: string; templateId?: string | null; replyToEmailId?: string | null }) =>
  request<{ email: { emailId: string; status: string } }>(`/api/crm/email/${entity}/${id}`, { method: "POST", json: input }).then((result) => result.email);
export const listEmails = (entity: EmailEntity, id: string) => request<{ emails: RecordEmail[] }>(`/api/crm/email/${entity}/${id}/messages`).then((result) => result.emails);

export const listEmailTemplates = (all = false) => request<{ templates: EmailTemplate[] }>(`/api/crm/email-templates${all ? "?all=1" : ""}`).then((result) => result.templates);
export const createEmailTemplate = (input: Partial<EmailTemplate>) => request<{ template: EmailTemplate }>("/api/crm/email-templates", { method: "POST", json: input }).then((result) => result.template);
export const updateEmailTemplate = (id: string, input: Partial<EmailTemplate>) =>
  request<{ template: EmailTemplate }>(`/api/crm/email-templates/${id}`, { method: "PATCH", json: input }).then((result) => result.template);
export const getEmailSettings = () => request<{ settings: EmailSettings }>("/api/crm/email-settings").then((result) => result.settings);
export const saveEmailSettings = (input: { replyToAddress?: string | null; signature?: string | null }) =>
  request<{ settings: EmailSettings }>("/api/crm/email-settings", { method: "PUT", json: input }).then((result) => result.settings);

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
