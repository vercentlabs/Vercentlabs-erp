import {
  createBillOfMaterial,
  createWorkOrder,
  listManufacturingResource,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { manufacturingContext } from "@/lib/manufacturing";
import {
  bomCreateSchema,
  workOrderCreateSchema,
} from "@/lib/manufacturing-validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const limit = request.nextUrl.searchParams.get("limit") || "100";
  const offset = request.nextUrl.searchParams.get("offset") || "0";
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listManufacturingResource(client, manufacturingContext(session), resource, {
      limit: Number(limit),
      offset: Number(offset),
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
    if (resource === "boms") {
      return createBillOfMaterial(
        client,
        manufacturingContext(session),
        bomCreateSchema.parse(body),
      );
    }
    if (resource === "work-orders") {
      return createWorkOrder(
        client,
        manufacturingContext(session),
        workOrderCreateSchema.parse(body),
      );
    }
    throw new Error("Creation is not supported for this resource.");
  });

  return NextResponse.json({ ok: true, row }, { status: 201 });
}
