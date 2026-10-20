import { z } from "zod";

import { saveQualitySettings } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { qualityMutation } from "@/features/quality/shared/route-helpers";

// Quality settings. Inspections and nonconformances have their own routes (/api/quality/*-inspections, /api/quality/nonconformances).
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return qualityMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    switch (action) {
      case "settings-save":
        return { record: await saveQualitySettings(client, context, input) };
      default:
        throw new HttpError(404, "Unknown Quality action.");
    }
  }, 200, "quality.view");
}
