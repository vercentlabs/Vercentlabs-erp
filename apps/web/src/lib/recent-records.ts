// Recent Records (Prompt 8, Part 7). Persisted server-side in the
// `recent_records` table — audit_events was ruled out (immutable,
// mutation-only by convention, wrong index shape for view tracking); this
// is a small, purpose-built table instead. Tracking happens inside the
// server-rendered detail pages that already resolved the record
// successfully (see trackRecentRecord below), so a row can only ever be
// written for something the viewing user could actually open — never a
// client-side fire-and-forget from an arbitrary href. Reads re-validate
// module accessibility exactly like favourites.ts, for the same reason: a
// stored href is never itself authorization.
import type { WorkspaceSessionContext } from "@/lib/auth";
import { query } from "@/lib/db";
import { isValidInternalHref } from "@/lib/internal-href";
import { resolveModuleAccess } from "@/lib/module-access";

import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

const MODULE_KEY_SET = new Set<string>(ERP_MODULE_CATALOG.map((m) => m.key));

export type RecentRecordItem = {
  id: string;
  targetType: string;
  href: string;
  label: string;
  moduleKey: string | null;
  viewedAt: string;
};

export async function listRecentRecords(
  session: WorkspaceSessionContext,
  limit = 30,
): Promise<RecentRecordItem[]> {
  const rows = await query<{
    id: string;
    target_type: string;
    target_href: string;
    label: string;
    module_key: string | null;
    viewed_at: Date;
  }>(
    `SELECT id, target_type, target_href, label, module_key, viewed_at
       FROM recent_records
      WHERE organization_id=$1 AND user_id=$2
      ORDER BY viewed_at DESC
      LIMIT ${Math.min(Math.max(Number(limit) || 30, 1), 50)}`,
    [session.organizationId, session.userId],
  );
  const results: RecentRecordItem[] = [];
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
      viewedAt: row.viewed_at.toISOString(),
    });
  }
  return results;
}

// Called from within server-rendered record detail pages, after the record
// has already been fetched successfully under that page's own access
// control — never called with an unchecked/user-supplied href. Best-effort:
// a failure here must never break the page it's called from.
export async function trackRecentRecord(
  session: WorkspaceSessionContext,
  input: { targetType: string; href: string; label: string; moduleKey?: string | null },
): Promise<void> {
  try {
    if (!isValidInternalHref(input.href)) return;
    const targetType = String(input.targetType || "record").slice(0, 60);
    const label = String(input.label || "").trim().slice(0, 200);
    if (!label) return;
    const moduleKey =
      input.moduleKey && MODULE_KEY_SET.has(input.moduleKey) ? input.moduleKey : null;
    await query(
      `INSERT INTO recent_records (organization_id, user_id, target_type, target_href, label, module_key, viewed_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (organization_id, user_id, target_href)
       DO UPDATE SET label = EXCLUDED.label, module_key = EXCLUDED.module_key, viewed_at = now()`,
      [session.organizationId, session.userId, targetType, input.href, label, moduleKey],
    );
  } catch {
    // Best-effort only — never let recent-record tracking break the page.
  }
}
