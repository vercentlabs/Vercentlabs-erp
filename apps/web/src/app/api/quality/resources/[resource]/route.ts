import {
  createInspection,
  createNonconformance,
  createQualityPlan,
  listQualityResource,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { qualityContext } from "@/modules/quality";
import {
  qualityInspectionCreateSchema,
  qualityNonconformanceCreateSchema,
  qualityPlanCreateSchema,
} from "@/modules/quality/validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireModuleWorkspace("quality");
    const { resource } = await params;
    const rows = await tenantTransaction(session.organizationId, (client) =>
      listQualityResource(client, qualityContext(session), resource, {
        sourceId: request.nextUrl.searchParams.get("sourceId"),
        limit: Number(request.nextUrl.searchParams.get("limit") || 100),
        offset: Number(request.nextUrl.searchParams.get("offset") || 0),
      }),
    );
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireModuleWorkspace("quality");
    const { resource } = await params;
    const body = await request.json();

    const row = await tenantTransaction(session.organizationId, (client) => {
      if (resource === "plans") {
        return createQualityPlan(
          client,
          qualityContext(session),
          qualityPlanCreateSchema.parse(body),
        );
      }
      if (resource === "inspections") {
        return createInspection(
          client,
          qualityContext(session),
          qualityInspectionCreateSchema.parse(body),
        );
      }
      if (resource === "non-conformances") {
        return createNonconformance(
          client,
          qualityContext(session),
          qualityNonconformanceCreateSchema.parse(body),
        );
      }
      throw new Error("Creation is not supported for this resource.");
    });

    return NextResponse.json({ ok: true, row }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
