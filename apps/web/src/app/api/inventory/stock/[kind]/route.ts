import {
  getStockAvailability,
  getStockDashboard,
  getStockSettings,
  listBusinessDataRecords,
  listStockBalancesDetailed,
  listStockBatchesWithBalance,
  listStockLedger,
  listStockOperationOptions,
  listStockReorderCandidates,
  listStockReorderRulesDetailed,
  listStockReservationsDetailed,
  listStockSerialsDetailed,
  listStockTransfersDetailed,
  lookupStockByCode,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// One read endpoint per Inventory screen. Every one is gated by stock.view (module-wide) and the
// domain function re-checks it; valuation fields are stripped server-side without
// stock.valuation.view (see the read models).
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return inventoryRead(async (client, context) => {
    switch (kind) {
      case "dashboard":
        {
        const dashboard = await getStockDashboard(client, context);
        const canSeeValue = context.roleSlugs.includes("organization_owner") || context.roleSlugs.includes("system_administrator") || context.permissions.includes("stock.valuation.view");
        return { dashboard: canSeeValue ? dashboard : { ...dashboard, inventory_value: null } };
      }
      case "settings":
        return { settings: await getStockSettings(client, context) };
      case "options": {
        const base = await listStockOperationOptions(client, context);
        const [uoms, groups] = await Promise.all([
          listBusinessDataRecords(client, context, "units-of-measure", { status: "active", limit: 500 }),
          listBusinessDataRecords(client, context, "item-groups", { status: "active", limit: 500 }),
        ]);
        return { options: { ...base, uoms: uoms.rows, groups: groups.rows } };
      }
      case "balances":
        return { rows: await listStockBalancesDetailed(client, context, { itemId: get("itemId"), warehouseId: get("warehouseId"), search: get("search") }) };
      case "ledger":
        return { rows: await listStockLedger(client, context, { itemId: get("itemId"), warehouseId: get("warehouseId"), movementType: get("movementType"), referenceType: get("referenceType"), referenceId: get("referenceId") }) };
      case "transfers":
        return { rows: await listStockTransfersDetailed(client, context, { status: get("status") }) };
      case "reservations":
        return { rows: await listStockReservationsDetailed(client, context, { status: get("status") }) };
      case "batches":
        return { rows: await listStockBatchesWithBalance(client, context, { withinDays: get("withinDays") }) };
      case "serials":
        return { rows: await listStockSerialsDetailed(client, context, { itemId: get("itemId"), status: get("status") }) };
      case "reorder-rules":
        return { rows: await listStockReorderRulesDetailed(client, context) };
      case "replenishment":
        return { rows: (await listStockReorderCandidates(client, context, { limit: 200 })).map((row) => ({ id: String(row.reorderRuleId), ...row })) };
      case "availability":
        return { availability: await getStockAvailability(client, context, { itemId: get("itemId"), warehouseId: get("warehouseId"), requestedQuantity: get("requestedQuantity") }) };
      case "lookup":
        return { result: await lookupStockByCode(client, context, { code: get("code") }) };
      default:
        throw new HttpError(404, "Unknown inventory view.");
    }
  });
}
