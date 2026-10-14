import { createQualityTemplate, listQualityTemplates } from "@vercentlabs/api";

import { templateSchema } from "@/features/manufacturing/quality/api/qi-schemas";
import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// Inspection checklists (?status=&itemId=).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["status", "itemId"].map((key) => [key, url.searchParams.get(key) || undefined]));
  return manufacturingRead(request, async (client, context) => ({ templates: await listQualityTemplates(client, context, filters) }));
}

// A checklist and its first revision, in force at once.
export async function POST(request: Request) {
  return manufacturingMutation(request, templateSchema, async (client, context, input) => ({ template: await createQualityTemplate(client, context, input) }), 201);
}
