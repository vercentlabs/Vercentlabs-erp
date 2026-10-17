import { z } from "zod";

import { saveAssetSettings } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { assetsMutation } from "@/features/assets/shared/route-helpers";

const body = z.record(z.string(), z.unknown());

// The Assets desk's remaining generic action: the Company's asset settings. Every other operation has its own workspace routes
// (register, categories, custody, transfers, assignments, depreciation, maintenance, disposals), each enforcing its own permission.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return assetsMutation(
    request,
    body,
    async (client, context, input) => {
      switch (action) {
        case "settings-save":
          return { record: await saveAssetSettings(client, context, input) };
        default:
          throw new HttpError(404, "Unknown Assets action.");
      }
    },
    200,
    "assets.view",
  );
}
