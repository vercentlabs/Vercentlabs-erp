import {
  assignAsset,
  capitalizeManagedAsset,
  createMaintenanceOrder,
  disposeManagedAsset,
} from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { assetsContext } from "@/modules/assets";
import { assetActionSchema } from "@/modules/assets/validation";
import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireModuleWorkspace } from "@/core/module-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireModuleWorkspace("assets");
    const { id } = await params;
    const input = assetActionSchema.parse(await request.json());

    const row = await tenantTransaction(session.organizationId, (client) => {
      if (input.action === "capitalize") {
        return capitalizeManagedAsset(client, assetsContext(session), id, input);
      }
      if (input.action === "assign") {
        return assignAsset(client, assetsContext(session), id, input);
      }
      if (input.action === "create_maintenance") {
        return createMaintenanceOrder(client, assetsContext(session), id, input);
      }
      return disposeManagedAsset(client, assetsContext(session), id, input);
    });

    return NextResponse.json({ ok: true, row });
  } catch (error) {
    return errorResponse(error);
  }
}
