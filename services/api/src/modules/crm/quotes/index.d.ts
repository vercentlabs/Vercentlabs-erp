import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};
export type DealQuoteCapabilities = { create: boolean; edit: boolean; upgrade: boolean };
export type DealQuoteView = { quote: Record<string, any>; lines: Array<Record<string, any>>; capabilities: DealQuoteCapabilities };

export function dealQuoteCapabilities(context: CrmContext): DealQuoteCapabilities;
export function quoteLineTax(line: { quantity: number; unitPrice: number; discountPercent?: number; gstRate?: number }, intraState: boolean):
  { gross: number; taxable: number; cgst: number; sgst: number; igst: number; total: number };
export function listDealQuotes(client: QueryClient, context: CrmContext, opportunityId: string): Promise<{ quotes: Array<Record<string, any>>; capabilities: DealQuoteCapabilities }>;
export function getDealQuote(client: QueryClient, context: CrmContext, quoteId: string): Promise<DealQuoteView>;
export function createDealQuote(client: QueryClient, context: CrmContext, opportunityId: string, input?: { kind?: string }): Promise<DealQuoteView>;
export function updateDealQuote(client: QueryClient, context: CrmContext, quoteId: string, input?: Record<string, unknown>): Promise<DealQuoteView>;
export function setDealQuoteStatus(client: QueryClient, context: CrmContext, quoteId: string, status: string): Promise<DealQuoteView>;
export function dealQuoteShareLink(client: QueryClient, context: CrmContext, quoteId: string, env?: Record<string, string | undefined>): Promise<{ url: string }>;
export function emailDealQuote(client: QueryClient, context: CrmContext, quoteId: string, input: Record<string, unknown>, attachment: { fileName: string; content: Buffer } | null,
  env?: Record<string, string | undefined>): Promise<{ quoteId: string; status: string; messageId?: string }>;
export function upgradeDealQuoteToSales(client: QueryClient, context: CrmContext, quoteId: string, input?: Record<string, unknown>): Promise<any>;
export function resolveSharedDealQuote(client: QueryClient, token: string): Promise<{ organizationId: string; quoteId: string } | null>;
export function loadSharedDealQuote(client: QueryClient, organizationId: string, quoteId: string): Promise<DealQuoteView>;
