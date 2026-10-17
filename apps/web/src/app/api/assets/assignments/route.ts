import { createAssignmentRequest, listAssignmentRequests } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation, assetsRead } from "@/features/assets/shared/route-helpers";

// GET the directory (?view=&search=&assetId=&userId=) · POST a request { assetId? | asset? | categoryId?, recipientType, toUserId? | …, purpose, assignmentType, …, idempotencyKey?, submit? }
export async function GET(request: Request) {
  const url = new URL(request.url);
  return assetsRead(request, (client, context) => listAssignmentRequests(client, context, Object.fromEntries(url.searchParams.entries())));
}
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => createAssignmentRequest(client, context, input));
}
