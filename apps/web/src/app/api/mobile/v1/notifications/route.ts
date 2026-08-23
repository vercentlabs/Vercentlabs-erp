import { query } from "@/core/db";
import { HttpError, readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    const rows = await query<{ id: string; title: string; message: string; href: string | null; read_at: Date | null; created_at: Date }>(
      `SELECT id,title,message,href,read_at,created_at FROM notifications WHERE organization_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [session.organizationId, session.userId],
    );
    return mobileOk(request, { notifications: rows.map((row) => ({ id: row.id, title: row.title, message: row.message, href: row.href, readAt: row.read_at?.toISOString() || null, createdAt: row.created_at.toISOString() })) });
  } catch (error) { return mobileError(request, error); }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireMobileSession(request);
    const input = await readJson(request) as { id?: string; all?: boolean };
    if (!input.all && !input.id) throw new HttpError(400, "Notification id is required.");
    if (input.all) await query(`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE organization_id=$1 AND user_id=$2`, [session.organizationId, session.userId]);
    else await query(`UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND organization_id=$2 AND user_id=$3`, [input.id, session.organizationId, session.userId]);
    return mobileOk(request, { message: "Notifications updated." });
  } catch (error) { return mobileError(request, error); }
}
