import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DomainNotFoundError, type SessionDto } from '@vercentlabs/contracts';
import { withUserScope } from '@vercentlabs/database';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { toSessionDto } from '../mappers.js';
import {
  findSessionById,
  listActiveSessionsForUser,
  revokeOtherSessionsForUser,
  revokeSessionById,
} from '../repository/sessions.js';

export async function listSessions(
  db: NodePgDatabase,
  input: { userId: string; currentSessionId: string },
): Promise<SessionDto[]> {
  const rows = await withUserScope(db, input.userId, (tx) =>
    listActiveSessionsForUser(tx, input.userId),
  );
  return rows.map((row) => toSessionDto(row, input.currentSessionId));
}

export async function revokeOwnSession(
  db: NodePgDatabase,
  input: { userId: string; sessionId: string; correlationId: string; requestId: string },
): Promise<void> {
  await withUserScope(db, input.userId, async (tx) => {
    const target = await findSessionById(tx, input.sessionId);
    if (!target || target.userId !== input.userId) {
      // Identical NOT_FOUND shape whether the session id is unknown or
      // belongs to someone else - RLS already guarantees the SELECT above
      // returns no row for another user's session; this check also covers
      // the (rare) case of a lookup outside RLS-scoped SQL.
      throw new DomainNotFoundError('Session', input.sessionId);
    }
    await revokeSessionById(tx, input.sessionId, 'user_revoked');
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'session.revoked',
      targetType: 'Session',
      targetId: input.sessionId,
      reason: 'user_revoked',
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
  });
}

export async function revokeOtherSessions(
  db: NodePgDatabase,
  input: { userId: string; currentSessionId: string; correlationId: string; requestId: string },
): Promise<void> {
  await withUserScope(db, input.userId, async (tx) => {
    await revokeOtherSessionsForUser(
      tx,
      input.userId,
      input.currentSessionId,
      'user_revoked_others',
    );
    await recordAuditEvent(tx, {
      actorId: input.userId,
      actorType: 'user',
      action: 'session.revoked_others',
      targetType: 'User',
      targetId: input.userId,
      reason: 'user_revoked_others',
      correlationId: input.correlationId,
      requestId: input.requestId,
    });
  });
}
