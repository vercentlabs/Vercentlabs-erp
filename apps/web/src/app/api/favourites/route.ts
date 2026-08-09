import { z } from "zod";

import { getSessionContext, type WorkspaceSessionContext } from "@/lib/auth";
import { addFavourite, listFavourites, removeFavourite } from "@/lib/favourites";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

const createSchema = z.object({
  targetType: z.string().trim().min(1).max(60),
  href: z.string().trim().min(1).max(400),
  label: z.string().trim().min(1).max(200),
  moduleKey: z.string().trim().max(60).optional().nullable(),
});

const deleteSchema = z.object({
  id: z.string().uuid(),
});

export async function GET() {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to continue.");
    const favourites = await listFavourites(session as WorkspaceSessionContext, 100);
    return ok({ favourites });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to continue.");
    const input = createSchema.parse(await readJson(request));
    const favourite = await addFavourite(session as WorkspaceSessionContext, input);
    return ok({ favourite }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to continue.");
    const { id } = deleteSchema.parse(await readJson(request));
    await removeFavourite(session as WorkspaceSessionContext, id);
    return ok({ message: "Favourite removed." });
  } catch (error) {
    return errorResponse(error);
  }
}
