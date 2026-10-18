import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export type CaptureFormFieldName = "firstName" | "lastName" | "email" | "mobile" | "phone" | "companyName" | "jobTitle" | "website" | "city" | "state" | "countryCode" | "industry" | "productInterest" | "description";
export type CaptureForm = {
  id: string; name: string; publicKey: string; status: "active" | "inactive"; fields: Array<{ name: CaptureFormFieldName; required: boolean }>;
  sourceId: string | null; sourceName: string | null; campaignId: string | null; campaignName: string | null; ownerUserId: string | null; ownerName: string | null; allowedOrigins: string[];
  successMessage: string; thankYouUrl: string | null; rateLimitPerHour: number; noticeText: string | null; noticeVersion: number | null;
  leadCount: number; createdAt: string; updatedAt: string;
};
export type CaptureNotice = { id: string; version: number; text: string; createdAt: string; createdByName: string | null; leadCount: number };
export type PublicCaptureForm = {
  organizationName: string; name: string; language?: string; submitLabel?: string; fields: Array<{ name: CaptureFormFieldName; label: string; type: string; required: boolean }>;
  notice: { text: string; version: number } | null; successMessage: string; thankYouUrl: string | null;
};

export const CAPTURE_FORM_PERMISSION: "crm.capture.manage";
export const CAPTURE_FORM_FIELDS: ReadonlyArray<{ name: CaptureFormFieldName; label: string; type: string }>;
export function listCaptureForms(client: QueryClient, context: CrmContext): Promise<CaptureForm[]>;
export function getCaptureForm(client: QueryClient, context: CrmContext, formId: string): Promise<CaptureForm>;
export function listCaptureNotices(client: QueryClient, context: CrmContext, formId: string): Promise<CaptureNotice[]>;
export function createCaptureForm(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CaptureForm>;
export function updateCaptureForm(client: QueryClient, context: CrmContext, formId: string, input: Record<string, unknown>): Promise<CaptureForm>;
export function setCaptureFormStatus(client: QueryClient, context: CrmContext, formId: string, status: "active" | "inactive"): Promise<CaptureForm>;
export function getPublicCaptureForm(queryable: QueryClient, formKey: string): Promise<PublicCaptureForm | null>;
