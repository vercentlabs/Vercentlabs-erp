import {
  createStore,
  createTerminal,
  listPointOfSaleResource,
  openShift,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";
import { pointOfSaleContext } from "@/modules/point-of-sale";
import {
  posShiftOpenSchema,
  posStoreCreateSchema,
  posTerminalCreateSchema,
} from "@/modules/point-of-sale/validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  try {
    const session = await requireModuleWorkspace("point-of-sale");
    const { resource } = await params;
    const rows = await tenantTransaction(session.organizationId, (client) =>
      listPointOfSaleResource(client, pointOfSaleContext(session), resource, {
        shiftId: request.nextUrl.searchParams.get("shiftId"),
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
    const session = await requireModuleWorkspace("point-of-sale");
    const { resource } = await params;
    const body = await request.json();

    const row = await tenantTransaction(session.organizationId, (client) => {
      if (resource === "stores") {
        return createStore(
          client,
          pointOfSaleContext(session),
          posStoreCreateSchema.parse(body),
        );
      }
      if (resource === "terminals") {
        return createTerminal(
          client,
          pointOfSaleContext(session),
          posTerminalCreateSchema.parse(body),
        );
      }
      if (resource === "shifts") {
        return openShift(
          client,
          pointOfSaleContext(session),
          posShiftOpenSchema.parse(body),
        );
      }
      throw new Error("Creation is not supported for this resource.");
    });

    return NextResponse.json({ ok: true, row }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
