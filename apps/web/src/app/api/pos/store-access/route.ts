import { z } from "zod";

import { assertSameOriginOrMobile, grantPosStoreAccess, listPosStoreAccess, revokePosStoreAccess } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const accessSchema = z.object({ userId: z.string().uuid(), storeId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const storeId = url.searchParams.get("storeId");
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage");
      return listPosStoreAccess(client, posContext(session), storeId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = accessSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage");
      return grantPosStoreAccess(client, posContext(session), input);
    });
    return ok({ grant: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const input = accessSchema.parse({ userId: url.searchParams.get("userId"), storeId: url.searchParams.get("storeId") });
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.store.manage");
      return revokePosStoreAccess(client, posContext(session), input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
