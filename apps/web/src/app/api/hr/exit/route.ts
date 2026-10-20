import {
  acceptSeparation, completeSeparation, getEmployeeExit, getSeparation, listSeparations, rejectSeparation, setPayrollEligibility, settleSeparation, startSeparation, withdrawSeparation,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { hrMutation, hrRead } from "@/features/hr/shared/route-helpers";

// HR › Exits: ?employeeId → the employee's exit panel; ?id → one exit; otherwise the list (?status, ?settlement).
// POST { action: start | accept | reject | withdraw | complete | settle | eligibility, id?, employeeId?, ... }.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return hrRead(request, async (client, context) => {
    if (q.get("employeeId")) return getEmployeeExit(client, context, q.get("employeeId") as string);
    if (q.get("id")) return getSeparation(client, context, q.get("id") as string);
    return { rows: await listSeparations(client, context, { status: q.get("status") || undefined, settlement: q.get("settlement") || undefined }) };
  });
}
export async function POST(request: Request) {
  return hrMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const id = String(input.id ?? "");
    switch (input.action) {
      case "start": return startSeparation(client, context, input);
      case "accept": return acceptSeparation(client, context, id, input);
      case "reject": return rejectSeparation(client, context, id, input);
      case "withdraw": return withdrawSeparation(client, context, id, input);
      case "complete": return completeSeparation(client, context, id, input);
      case "settle": return settleSeparation(client, context, id, input);
      case "eligibility": return setPayrollEligibility(client, context, String(input.employeeId ?? ""), input);
      default: throw new HttpError(400, "Unknown action.");
    }
  });
}
