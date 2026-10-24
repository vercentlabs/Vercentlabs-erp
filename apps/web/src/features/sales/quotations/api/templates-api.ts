// Quotation templates (Sales report Phase 2): set up in Sales › Setup, used to start a new quotation.
import { del, patch, post, request } from "@/features/sales/shared/http";

export type TemplateLine = { itemId: string; quantity: number; uomId?: string | null; description?: string | null; discountType?: "percent" | "amount"; discountValue?: number };
export type TemplateSection = { kind: "section" | "note"; text: string; position: number };
export type QuotationTemplate = {
  id: string; name: string; description: string | null; validityDays: number | null; paymentTermId: string | null; termsAndConditions: string | null;
  customerNotes: string | null; lines: TemplateLine[]; sectionLines: TemplateSection[]; active: boolean; updatedAt: string; lineCount: number;
};
export type QuotationTemplateInput = {
  name: string; description?: string | null; validityDays?: number | null; paymentTermId?: string | null; termsAndConditions?: string | null; customerNotes?: string | null;
  lines: TemplateLine[]; sectionLines: TemplateSection[];
};

export const listQuotationTemplates = (includeInactive = false) =>
  request<{ templates: QuotationTemplate[] }>(`/quotation-templates${includeInactive ? "?includeInactive=1" : ""}`).then((result) => result.templates);
export const getQuotationTemplate = (id: string) => request<{ template: QuotationTemplate }>(`/quotation-templates/${id}`).then((result) => result.template);
export const createQuotationTemplate = (input: QuotationTemplateInput) => post<{ template: QuotationTemplate }>("/quotation-templates", input).then((result) => result.template);
export const updateQuotationTemplate = (id: string, input: QuotationTemplateInput) => patch<{ template: QuotationTemplate }>(`/quotation-templates/${id}`, input).then((result) => result.template);
export const setQuotationTemplateActive = (id: string, active: boolean) => post<{ template: QuotationTemplate }>(`/quotation-templates/${id}`, { active });
export const deleteQuotationTemplate = (id: string) => del<{ deleted: boolean }>(`/quotation-templates/${id}`);
