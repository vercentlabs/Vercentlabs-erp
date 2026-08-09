// Favourites (Prompt 8, Part 8). Persisted in the `favourites` table
// (database/control-plane/migrations/029_shared_workspace_favourites_and_recents.sql),
// following user_preferences' own (organization_id, user_id) ownership
// pattern. A stored href is never itself authorization: listFavourites()
// re-validates every row's current module accessibility on every read, and
// addFavourite() only accepts a same-origin internal path shaped like a
// real navigation area — never an external URL, `javascript:`, or an
// arbitrary unchecked string.
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import type { WorkspaceSessionContext } from "@/lib/auth";
import { query } from "@/lib/db";
import { HttpError } from "@/lib/http";
import { isValidInternalHref } from "@/lib/internal-href";
import { resolveModuleAccess } from "@/lib/module-access";

export { isValidInternalHref } from "@/lib/internal-href";

const MODULE_KEY_SET = new Set<string>(ERP_MODULE_CATALOG.map((m) => m.key));

export type FavouriteItem = {
  id: string;
  targetType: string;
  href: string;
  label: string;
  moduleKey: string | null;
  createdAt: string;
};

async function revalidate(
  session: WorkspaceSessionContext,
  rows: Array<{
    id: string;
    target_type: string;
    target_href: string;
    label: string;
    module_key: string | null;
    created_at?: Date;
    viewed_at?: Date;
  }>,
) {
  const results: Array<{
    id: string;
    targetType: string;
    href: string;
    label: string;
    moduleKey: string | null;
    at: Date;
  }> = [];
  for (const row of rows) {
    if (row.module_key && MODULE_KEY_SET.has(row.module_key)) {
      const access = await resolveModuleAccess(session, row.module_key);
      if (!access.accessible) continue;
    }
    results.push({
      id: row.id,
      targetType: row.target_type,
      href: row.target_href,
      label: row.label,
      moduleKey: row.module_key,
      at: (row.created_at ?? row.viewed_at) as Date,
    });
  }
  return results;
}

export async function listFavourites(
  session: WorkspaceSessionContext,
  limit = 50,
): Promise<FavouriteItem[]> {
  const rows = await query<{
    id: string;
    target_type: string;
    target_href: string;
    label: string;
    module_key: string | null;
    created_at: Date;
  }>(
    `SELECT id, target_type, target_href, label, module_key, created_at
       FROM favourites
      WHERE organization_id=$1 AND user_id=$2
      ORDER BY created_at DESC
      LIMIT ${Math.min(Math.max(Number(limit) || 50, 1), 200)}`,
    [session.organizationId, session.userId],
  );
  const revalidated = await revalidate(session, rows);
  return revalidated.map((item) => ({
    id: item.id,
    targetType: item.targetType,
    href: item.href,
    label: item.label,
    moduleKey: item.moduleKey,
    createdAt: item.at.toISOString(),
  }));
}

export async function addFavourite(
  session: WorkspaceSessionContext,
  input: { targetType: string; href: string; label: string; moduleKey?: string | null },
): Promise<FavouriteItem> {
  if (!isValidInternalHref(input.href)) {
    throw new HttpError(400, "That destination cannot be favourited.");
  }
  const targetType = String(input.targetType || "record").slice(0, 60);
  const label = String(input.label || "").trim().slice(0, 200);
  if (!label) throw new HttpError(400, "A label is required.");
  const moduleKey =
    input.moduleKey && MODULE_KEY_SET.has(input.moduleKey) ? input.moduleKey : null;

  const [row] = await query<{
    id: string;
    target_type: string;
    target_href: string;
    label: string;
    module_key: string | null;
    created_at: Date;
  }>(
    `INSERT INTO favourites (organization_id, user_id, target_type, target_href, label, module_key)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (organization_id, user_id, target_href)
     DO UPDATE SET label = EXCLUDED.label, module_key = EXCLUDED.module_key
     RETURNING id, target_type, target_href, label, module_key, created_at`,
    [session.organizationId, session.userId, targetType, input.href, label, moduleKey],
  );
  return {
    id: row.id,
    targetType: row.target_type,
    href: row.target_href,
    label: row.label,
    moduleKey: row.module_key,
    createdAt: row.created_at.toISOString(),
  };
}

export async function removeFavourite(
  session: WorkspaceSessionContext,
  id: string,
): Promise<void> {
  await query(
    `DELETE FROM favourites WHERE id=$1 AND organization_id=$2 AND user_id=$3`,
    [id, session.organizationId, session.userId],
  );
}

export async function isFavourited(
  session: WorkspaceSessionContext,
  href: string,
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM favourites WHERE organization_id=$1 AND user_id=$2 AND target_href=$3`,
    [session.organizationId, session.userId, href],
  );
  return rows.length > 0;
}
