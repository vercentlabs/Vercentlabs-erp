import { resolveSpecificationException, saveSpecificationPolicy } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

// Quality Settings for specifications: policy · resolve-exception (inspection requirements are Quality Control Points).
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return qualityMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "policy": return saveSpecificationPolicy(client, context, input);
      case "resolve-exception": return resolveSpecificationException(client, context, String(input.exceptionId ?? ""), input);
      default: throw new HttpError(404, "Unknown action.", "NOT_FOUND");
    }
  });
}
