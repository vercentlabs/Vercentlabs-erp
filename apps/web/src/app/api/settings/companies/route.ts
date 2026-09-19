import { z } from "zod";

import { assertSameOriginOrMobile, audit, createCompany, listOrganizationCompanies } from "@vercentlabs/api";

import { transaction, withClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireApiWorkspace } from "@/core/session";

export async function GET() {
  try {
    const session = await requireApiWorkspace();
    const companies = await withClient((client) => listOrganizationCompanies(client, session));
    return ok({ companies });
  } catch (error) {
    return errorResponse(error);
  }
}

const postSchema = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(30),
  countryCode: z.string().trim().length(2),
  baseCurrency: z.string().trim().length(3),
  taxId: z.string().trim().max(50).optional(),
  isPrimary: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireApiWorkspace();
    const body = postSchema.parse(await readJson(request));
    const company = await transaction(async (client) => {
      const created = await createCompany(client, session, body);
      await audit(client, {
        organizationId: session.organizationId,
        actorUserId: session.userId,
        eventType: "company.created",
        entityType: "company",
        entityId: created.id,
        request,
        env: process.env,
      });
      return created;
    });
    return ok({ company }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
