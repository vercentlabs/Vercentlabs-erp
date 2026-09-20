import { z } from "zod";

import { assertSameOriginOrMobile, getPosSettings, updatePosSettings } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

// Bounds mirror the pos_settings CHECK constraints so a bad value is a clean
// 400 here rather than a database error; the domain function re-validates and
// also enforces the cross-field rule (approval threshold <= max line discount).
const updateSchema = z
  .object({
    require_shift_reconciliation: z.boolean(),
    allow_negative_stock: z.boolean(),
    allow_price_override: z.boolean(),
    require_return_approval: z.boolean(),
    prohibit_self_return_approval: z.boolean(),
    default_currency_code: z.string().trim().length(3),
    max_line_discount_percent: z.number().min(0).max(100),
    max_cart_discount_percent: z.number().min(0).max(100),
    discount_approval_threshold_percent: z.number().min(0).max(100),
    cart_expiry_minutes: z.number().int().min(5).max(10080),
  })
  .partial();

export async function GET() {
  try {
    const session = await requireWorkspace();
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage");
      return getPosSettings(client, posContext(session));
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = updateSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage", { mutation: true });
      return updatePosSettings(client, posContext(session), input);
    });
    return ok(result);
  } catch (error) {
    return errorResponse(error);
  }
}
