import { createQualityControlPoint, listQualityControlPoints } from "@vercentlabs/api";
import { z } from "zod";

import { qualityMutation, qualityRead } from "@/features/quality/shared/route-helpers";

// Quality — Quality Control Points: the directory (view, search, stage) and a new control point (a draft).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(request, async (client, context) => listQualityControlPoints(client, context, { view: get("view"), search: get("search"), stage: get("stage") }));
}
export async function POST(request: Request) {
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createQualityControlPoint(client, context, input), 201);
}
