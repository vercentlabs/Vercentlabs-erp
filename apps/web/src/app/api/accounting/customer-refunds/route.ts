import { z } from "zod";

import { createCustomerRefund, listCustomerRefunds } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

const FILTER_KEYS = [
  "view", "search", "status", "partyId", "paymentMethod", "bankAccountId", "currencyCode", "reasonCode", "creditNoteId", "receiptId", "dateFrom", "dateTo", "sort", "direction", "limit", "offset",
] as const;

// Finance → Customer Refunds.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters: Record<string, string> = {};
  for (const key of FILTER_KEYS) {
    const value = url.searchParams.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => await listCustomerRefunds(client, context, filters), "accounting.refund.view");
}

// A draft refund of one credit source (a posted credit note's unapplied credit, or the unapplied part of a receipt). The customer and currency are the source's.
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  sourceType: z.enum(["credit_note", "receipt"]),
  sourceId: z.string().uuid(),
  amount: z.union([z.number(), z.string()]),
  refundDate: z.string().date().optional(),
  reasonCode: z.string().max(40).optional(),
  reasonNote: z.string().max(1000).nullable().optional(),
  paymentMethod: z.string().max(40).optional(),
  bankAccountId: z.string().uuid().nullable().optional(),
  externalReference: z.string().max(200).nullable().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
});

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({ result: await createCustomerRefund(client, context, input) }), 201, "accounting.refund.create");
}
