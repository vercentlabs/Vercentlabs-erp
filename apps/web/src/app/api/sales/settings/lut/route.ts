import { z } from "zod";

import { setRegistrationLut } from "@vercentlabs/api";

import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// The LUT each GSTIN exports under without IGST (Sales report Phase 3).
export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => ({
    registrations: (await client.query(
      `SELECT id, name, registration_number AS gstin, lut_number AS "lutNumber", lut_date::text AS "lutDate" FROM tenant.tax_registrations
        WHERE organization_id = $1 AND status = 'active' AND registration_number IS NOT NULL ORDER BY is_default DESC, name`, [context.organizationId])).rows,
  }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.view", z.object({ registrationId: z.string().uuid(), lutNumber: z.string().max(40).nullable(), lutDate: z.string().max(10).nullable() }),
    async (client, context, input) => setRegistrationLut(client, context, input.registrationId, input));
}
