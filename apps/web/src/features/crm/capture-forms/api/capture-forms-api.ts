"use client";

// Browser client for CRM › Setup › Web forms (/api/crm/capture-forms).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class CaptureFormApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(CaptureFormApiError, "body");
const BASE = "/api/crm/capture-forms";

export type CaptureFieldName = "firstName" | "lastName" | "email" | "mobile" | "phone" | "companyName" | "jobTitle" | "website" | "city" | "state" | "countryCode" | "industry" | "productInterest" | "description";
export const CAPTURE_FIELDS: Array<{ name: CaptureFieldName; label: string }> = [
  { name: "firstName", label: "First name" }, { name: "lastName", label: "Last name" }, { name: "email", label: "Email" }, { name: "mobile", label: "Mobile" },
  { name: "phone", label: "Phone" }, { name: "companyName", label: "Company" }, { name: "jobTitle", label: "Job title" }, { name: "website", label: "Website" },
  { name: "city", label: "City" }, { name: "state", label: "State" }, { name: "countryCode", label: "Country" }, { name: "industry", label: "Industry" },
  { name: "productInterest", label: "What are you interested in?" }, { name: "description", label: "Message" },
];

export type CaptureForm = {
  id: string; name: string; publicKey: string; status: "active" | "inactive"; fields: Array<{ name: CaptureFieldName; required: boolean }>; language?: string;
  sourceId: string | null; sourceName: string | null; campaignId: string | null; campaignName: string | null; ownerUserId: string | null; ownerName: string | null; allowedOrigins: string[];
  successMessage: string; thankYouUrl: string | null; rateLimitPerHour: number; noticeText: string | null; noticeVersion: number | null;
  leadCount: number; createdAt: string; updatedAt: string;
};
export type CaptureNotice = { id: string; version: number; text: string; createdAt: string; createdByName: string | null; leadCount: number };

export const listCaptureForms = () => request<{ forms: CaptureForm[] }>(BASE).then((result) => result.forms);
export const createCaptureForm = (input: Record<string, unknown>) => request<{ form: CaptureForm }>(BASE, { method: "POST", json: input }).then((result) => result.form);
export const updateCaptureForm = (id: string, input: Record<string, unknown>) =>
  request<{ form: CaptureForm }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.form);
export const setCaptureFormStatus = (id: string, status: "active" | "inactive") =>
  request<{ form: CaptureForm }>(`${BASE}/${id}/status`, { method: "POST", json: { status } }).then((result) => result.form);
export const listCaptureNotices = (id: string) => request<{ notices: CaptureNotice[] }>(`${BASE}/${id}/notices`).then((result) => result.notices);

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = (error as { details?: { issues?: Array<{ field: string; message: string }> } })?.details?.issues ?? [];
  return Object.fromEntries(issues.map((issue) => [issue.field, issue.message]));
}
