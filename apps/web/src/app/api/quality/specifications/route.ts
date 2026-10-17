import { createInspectionSpecification, listInspectionSpecifications } from "@vercentlabs/api";
import { z } from "zod";

import { qualityMutation, qualityRead } from "@/features/quality/shared/route-helpers";

// Quality — Inspection Specifications: the directory (view, search, stage, item, supplier, sort) and a new specification (a draft).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  return qualityRead(request, async (client, context) =>
    listInspectionSpecifications(client, context, { view: get("view"), search: get("search"), stage: get("stage"), itemId: get("itemId"), supplierId: get("supplierId"), sort: get("sort") }));
}
export async function POST(request: Request) {
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createInspectionSpecification(client, context, input), 201);
}
