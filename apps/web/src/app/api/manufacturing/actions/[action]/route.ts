import { z } from "zod";

import {
  activateRouting,
  addCalendarException,
  addComponentAlternate,
  addShift,
  approveBom,
  cancelEngineeringChange,
  createBom,
  createRouting,
  createEngineeringChange,
  decideEngineeringChange,
  implementEngineeringChange,
  obsoleteBom,
  obsoleteRouting,
  rejectBom,
  removeCalendarException,
  removeComponentAlternate,
  removeShift,
  reviseBom,
  reviseRouting,
  saveCalendar,
  saveWorkCenter,
  submitBom,
  submitEngineeringChange,
  updateDraftBom,
  updateDraftRouting,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Manufacturing operation. Each domain function enforces its OWN
// permission and state machine (and segregation of duties where a second person must approve).
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return manufacturingMutation(request, body, async (client, context, input) => {
    switch (action) {
      case "bom-create":
        return { record: await createBom(client, context, input) };
      case "bom-update":
        return { record: await updateDraftBom(client, context, idOf(input), input) };
      case "bom-submit":
        return { record: await submitBom(client, context, idOf(input)) };
      case "bom-approve":
        return { record: await approveBom(client, context, idOf(input)) };
      case "bom-reject":
        return { record: await rejectBom(client, context, idOf(input), String(input.reason ?? "")) };
      case "bom-obsolete":
        return { record: await obsoleteBom(client, context, idOf(input), String(input.reason ?? "")) };
      case "bom-revise":
        return { record: await reviseBom(client, context, idOf(input), input) };
      case "alternate-add":
        return { record: await addComponentAlternate(client, context, String(input.componentId ?? ""), input) };
      case "alternate-remove":
        return { record: await removeComponentAlternate(client, context, idOf(input)) };
      case "change-create":
        return { record: await createEngineeringChange(client, context, input) };
      case "change-submit":
        return { record: await submitEngineeringChange(client, context, idOf(input)) };
      case "change-decide":
        return { record: await decideEngineeringChange(client, context, idOf(input), { approve: input.approve === true, note: String(input.note ?? "") }) };
      case "change-implement":
        return { record: await implementEngineeringChange(client, context, idOf(input)) };
      case "change-cancel":
        return { record: await cancelEngineeringChange(client, context, idOf(input), String(input.reason ?? "")) };
      case "work-center-save":
        return { record: await saveWorkCenter(client, context, input) };
      case "calendar-save":
        return { record: await saveCalendar(client, context, input) };
      case "shift-add":
        return { record: await addShift(client, context, input) };
      case "shift-remove":
        return { record: await removeShift(client, context, idOf(input)) };
      case "exception-add":
        return { record: await addCalendarException(client, context, input) };
      case "exception-remove":
        return { record: await removeCalendarException(client, context, idOf(input)) };
      case "routing-create":
        return { record: await createRouting(client, context, input) };
      case "routing-update":
        return { record: await updateDraftRouting(client, context, idOf(input), input) };
      case "routing-activate":
        return { record: await activateRouting(client, context, idOf(input)) };
      case "routing-revise":
        return { record: await reviseRouting(client, context, idOf(input)) };
      case "routing-obsolete":
        return { record: await obsoleteRouting(client, context, idOf(input), String(input.reason ?? "")) };
      default:
        throw new HttpError(404, "Unknown manufacturing action.");
    }
  });
}
