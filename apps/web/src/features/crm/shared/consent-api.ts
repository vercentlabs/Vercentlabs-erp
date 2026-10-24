"use client";

// Browser client for the consent ledger, the opt-out list and the personal-data lookup (CRM plan 4.3).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class ConsentApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ConsentApiError, "body");

export type ConsentEvent = { id: string; channel: string; action: "opt_in" | "opt_out" | "consent_withdrawn" | "opt_out_lifted"; source: string; evidence: string | null; recordedAt: string; recordedByName: string | null };
export type OptOut = { kind: "email" | "phone"; value: string; channels: string[]; source: string; reason: string | null; createdAt: string; createdByName: string | null;
  // When it can come off the list without the person asking (90 days after it was added).
  removableFrom: string };
export type PersonalData = {
  query: { email: string | null; phone: string | null };
  leads: Array<{ id: string; code: string; name: string; email: string | null; mobile: string | null; status: string; createdAt: string }>;
  contacts: Array<{ id: string; code: string | null; name: string; email: string | null; mobile: string | null; status: string; createdAt: string }>;
  companies: Array<{ id: string; code: string; name: string; email: string | null; phone: string | null; status: string; createdAt: string }>;
  deals: Array<{ id: string; code: string; name: string; status: string; amount: number; currencyCode: string | null; createdAt: string }>;
  emails: Array<{ id: string; recordType: string; recordId: string; direction: string; subject: string; at: string }>;
  whatsapp: Array<{ id: string; recordType: string; recordId: string; direction: string; at: string }>;
  consent: Array<{ subjectType: string; subjectId: string; channel: string; action: string; source: string; evidence: string | null; at: string }>;
  optOuts: Array<{ kind: string; value: string; channels: string[]; source: string; at: string }>;
};

export const CHANNEL_LABEL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", call: "Calls", all: "Any contact" };
export const ACTION_LABEL: Record<string, string> = { opt_in: "Agreed", opt_out: "Opted out", consent_withdrawn: "Consent withdrawn", opt_out_lifted: "Opt-out lifted" };
export const SOURCE_LABEL = (source: string) => ({
  manual: "Recorded by staff", web_form: "Web form", import: "Import", conversion: "Carried over from the lead", whatsapp_message: "Their WhatsApp message",
  existing: "Recorded before the ledger", self_service: "The person themselves", email_reply: "Their email",
  unsubscribe: "Unsubscribed from an email", whatsapp_stop: "Replied STOP on WhatsApp",
} as Record<string, string>)[source] ?? (source.startsWith("connector:") ? `Lead connector (${source.slice(10)})` : source);

export const listConsentHistory = (type: "leads" | "contacts", id: string) => request<{ history: ConsentEvent[] }>(`/api/crm/consent/${type}/${id}`).then((result) => result.history);
export const listOptOuts = (search = "") => request<{ optOuts: OptOut[] }>(`/api/crm/opt-outs${search ? `?search=${encodeURIComponent(search)}` : ""}`).then((result) => result.optOuts);
export const addOptOut = (input: { email?: string; phone?: string; channels?: string[]; reason?: string }) =>
  request<{ optOuts: OptOut[] }>("/api/crm/opt-outs", { method: "POST", json: input }).then((result) => result.optOuts);
export const removeOptOut = (input: { kind: string; value: string; personAsked?: boolean; reason?: string }) => request<{ removed: true }>("/api/crm/opt-outs", { method: "DELETE", json: input });
export const lookupPersonalData = (input: { email?: string; phone?: string }) =>
  request<{ result: PersonalData }>(`/api/crm/privacy/lookup?${new URLSearchParams(Object.entries(input).filter(([, value]) => value) as Array<[string, string]>).toString()}`).then((result) => result.result);

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
