import { z } from "zod";

import { getTdsCertificates, recordTdsCertificate } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Customer TDS certificates (Sales report Phase 3): ?financialYear=2026 (its first year).
export async function GET(request: Request) {
  const year = Number(new URL(request.url).searchParams.get("financialYear")) || undefined;
  return salesRead(request, "sales.view", async (client, context) => getTdsCertificates(client, context, { financialYear: year }));
}

const schema = z.object({
  partyId: z.string().uuid(), financialYear: z.number().int().min(2000).max(2100), quarter: z.number().int().min(1).max(4), certificateNumber: z.string().trim().min(1).max(40),
  amount: z.number().positive(), receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), section: z.string().trim().max(20).optional(), notes: z.string().max(500).optional(),
});
export async function POST(request: Request) {
  return salesMutation(request, "sales.view", schema, async (client, context, input) => recordTdsCertificate(client, context, input), 201);
}
