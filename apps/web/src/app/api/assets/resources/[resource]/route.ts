import {
  createManagedAsset,
  createManagedAssetCategory,
  listAssetResource,
} from "@vercentlabs/api";
import { NextRequest, NextResponse } from "next/server";

import { requireApiWorkspace } from "@/lib/auth";
import { tenantTransaction } from "@/lib/db";
import { assetsContext } from "@/lib/assets";
import {
  assetCategoryCreateSchema,
  assetCreateSchema,
} from "@/lib/assets-validation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const rows = await tenantTransaction(session.organizationId, (client) =>
    listAssetResource(client, assetsContext(session), resource, {
      assetId: request.nextUrl.searchParams.get("assetId"),
      limit: Number(request.nextUrl.searchParams.get("limit") || 100),
      offset: Number(request.nextUrl.searchParams.get("offset") || 0),
    }),
  );
  return NextResponse.json({ ok: true, rows });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ resource: string }> },
) {
  const session = await requireApiWorkspace();
  const { resource } = await params;
  const body = await request.json();
  const row = await tenantTransaction(session.organizationId, (client) => {
    if (resource === "assets") {
      return createManagedAsset(
        client,
        assetsContext(session),
        assetCreateSchema.parse(body),
      );
    }
    if (resource === "categories") {
      return createManagedAssetCategory(
        client,
        assetsContext(session),
        assetCategoryCreateSchema.parse(body),
      );
    }
    throw new Error("Creation is not supported for this resource.");
  });
  return NextResponse.json({ ok: true, row }, { status: 201 });
}
