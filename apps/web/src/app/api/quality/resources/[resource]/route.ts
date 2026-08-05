import {
  createInspection,
  createNonconformance,
  createQualityPlan,
  listQualityResource,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { qualityContext } from "@/lib/quality";
import {
  qualityInspectionCreateSchema,
  qualityNonconformanceCreateSchema,
  qualityPlanCreateSchema,
} from "@/lib/quality-validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listQualityResource(client, qualityContext(session), resource, {
      sourceId: request.nextUrl.searchParams.get("sourceId"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 100),
      offset: Number(request.nextUrl.searchParams.get("offset") || 0),
    }),
  );
  return NextResponse.json({ ok: true, rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
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
}
