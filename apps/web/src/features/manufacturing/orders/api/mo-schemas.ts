import { z } from "zod";

// The fields of a manufacturing order's header, shared by create, edit and preview.
export const orderHeaderSchema = z.object({
  finishedItemId: z.string().uuid().optional(), plannedQuantity: z.union([z.string(), z.number()]).optional(), uomId: z.string().uuid().optional(),
  bomRevisionId: z.string().uuid().nullable().optional(), manufacturingWarehouseId: z.string().uuid().optional(), materialWarehouseId: z.string().uuid().optional(),
  finishedGoodsWarehouseId: z.string().uuid().optional(), plannedStartAt: z.string().max(40).optional(), plannedEndAt: z.string().max(40).optional(),
  sourceDemandType: z.enum(["MANUAL", "SALES_ORDER", "PLANNING", "PARENT_ORDER"]).optional(), sourceDemandId: z.string().uuid().nullable().optional(),
  sourceReference: z.string().max(200).nullable().optional(), priority: z.enum(["LOW", "NORMAL", "HIGH"]).optional(), notes: z.string().max(4000).nullable().optional(),
  productionOwnerId: z.string().uuid().nullable().optional(),
});
