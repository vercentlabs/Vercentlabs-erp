import {
  assignAsset,
  capitalizeManagedAsset,
  createMaintenanceOrder,
  disposeManagedAsset,
} from "@vercentlabs/api";
import { NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { assetsContext } from "@/lib/assets";
import { assetActionSchema } from "@/lib/assets-validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireApiWorkspace();
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
}
