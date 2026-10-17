import {
  approveMaintenanceWorkOrder, assignMaintenanceExecutor, cancelMaintenanceWorkOrder, completeMaintenanceWork, linkMaintenanceCapitalImprovement, linkMaintenancePartsConsumption, linkMaintenanceTransfer,
  linkMaintenanceVendorCost, recordMaintenanceWarranty, recordMaintenanceWork, reopenMaintenanceWorkOrder, returnAssetToService, scheduleMaintenanceWorkOrder, setMaintenanceWaiting, startMaintenanceWork,
  submitMaintenanceWorkOrder, unlinkMaintenanceCost, verifyMaintenanceRepair,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST submit · approve · assign · schedule · start · waiting · record · complete · verify · return-to-service · cancel · reopen · warranty · link-transfer · link-parts · link-vendor · link-capital · unlink { linkId, reason }
type Params = { params: Promise<{ workOrderId: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { workOrderId, action } = await ctx.params;
  return assetsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "submit": return submitMaintenanceWorkOrder(client, context, workOrderId, input);
      case "approve": return approveMaintenanceWorkOrder(client, context, workOrderId, input);
      case "assign": return assignMaintenanceExecutor(client, context, workOrderId, input);
      case "schedule": return scheduleMaintenanceWorkOrder(client, context, workOrderId, input);
      case "start": return startMaintenanceWork(client, context, workOrderId, input);
      case "waiting": return setMaintenanceWaiting(client, context, workOrderId, input);
      case "record": return recordMaintenanceWork(client, context, workOrderId, input);
      case "complete": return completeMaintenanceWork(client, context, workOrderId, input);
      case "verify": return verifyMaintenanceRepair(client, context, workOrderId, input);
      case "return-to-service": return returnAssetToService(client, context, workOrderId, input);
      case "cancel": return cancelMaintenanceWorkOrder(client, context, workOrderId, input);
      case "reopen": return reopenMaintenanceWorkOrder(client, context, workOrderId, input);
      case "warranty": return recordMaintenanceWarranty(client, context, workOrderId, input);
      case "link-transfer": return linkMaintenanceTransfer(client, context, workOrderId, input);
      case "link-parts": return linkMaintenancePartsConsumption(client, context, workOrderId, input);
      case "link-vendor": return linkMaintenanceVendorCost(client, context, workOrderId, input);
      case "link-capital": return linkMaintenanceCapitalImprovement(client, context, workOrderId, input);
      case "unlink": return unlinkMaintenanceCost(client, context, String(input.linkId ?? ""), input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
