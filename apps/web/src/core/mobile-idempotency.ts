import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SessionContext } from "@/core/auth";
import { HttpError } from "@/core/http";

export async function withMobileIdempotency<T extends Record<string, unknown>>(client: PoolClient, session: SessionContext, request: Request, input: unknown, work: () => Promise<T>): Promise<T> {
  const key = request.headers.get("idempotency-key") || "";
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new HttpError(400, "A valid Idempotency-Key is required.");
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const path = new URL(request.url).pathname;
  const inserted = await client.query(
    `INSERT INTO mobile_idempotency_keys(id,user_id,organization_id,idempotency_key,request_method,request_path,request_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING id`,
    [randomUUID(), session.userId, session.organizationId, key, request.method, path, requestHash],
  );
  if (!inserted.rows[0]) {
    const existing = await client.query<{ request_method: string; request_path: string; request_hash: string; response_body: T | null }>(
      `SELECT request_method,request_path,request_hash,response_body FROM mobile_idempotency_keys WHERE user_id=$1 AND idempotency_key=$2`,
      [session.userId, key],
    );
    const row = existing.rows[0];
    if (!row || row.request_method !== request.method || row.request_path !== path || row.request_hash !== requestHash) throw new HttpError(409, "This idempotency key was already used for a different request.");
    if (row.response_body) return row.response_body;
    throw new HttpError(409, "This request is already being processed.");
  }
  const response = await work();
  await client.query(`UPDATE mobile_idempotency_keys SET response_status=200,response_body=$3,completed_at=now() WHERE user_id=$1 AND idempotency_key=$2`, [session.userId, key, response]);
  return response;
}
