import { z } from "zod";

import { createPermissionProfile, listPermissionProfiles } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// ?status=draft|active|inactive, ?search=
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, (client, context) => listPermissionProfiles(client, context, { status: url.searchParams.get("status") ?? undefined,
    search: url.searchParams.get("search") ?? undefined }), "pos.permission_profiles.view");
}

// body: { code, name, description?, grants? }. Saved as Draft.
export async function POST(request: Request) {
  return posMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ profile: await createPermissionProfile(client, context, input) }), 201,
    "pos.permission_profiles.view");
}
