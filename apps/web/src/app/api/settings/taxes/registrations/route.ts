import { z } from "zod";

import { createTaxRegistration } from "@vercentlabs/api";

import { taxWrite } from "@/features/settings/taxes/server/tax-http";

const schema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  legalName: z.string().trim().max(200).nullish(),
  registrationNumber: z.string().trim().max(40).nullish(),
  countryCode: z.string().trim().length(2).optional(),
  stateCode: z.string().trim().max(10).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  isDefault: z.boolean().optional(),
});

export async function POST(request: Request) {
  return taxWrite(request, "tax.registrations.manage", schema, async (client, context, input) => ({ registration: await createTaxRegistration(client, context, input) }), 201);
}
