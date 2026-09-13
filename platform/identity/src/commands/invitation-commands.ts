import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { assertValidUuid } from '@vercentlabs/database';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  DomainValidationError,
  InvalidOrExpiredTokenError,
  isPlatformOperatorScope,
  type PlatformOperatorScope,
  type TrustedScope,
  type UserDto,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { hashToken, generateOpaqueToken } from '../crypto/token-hash.js';
import { normalizePassword } from '../crypto/password-normalize.js';
import { normalizeEmail } from '../normalize-email.js';
import { hashPassword } from '../crypto/password-hasher.js';
import { validatePasswordPolicy } from '../password-policy.js';
import { toUserDto } from '../mappers.js';
import {
  assertCanActivateUser,
  assertCanDeactivateUser,
  assertCanReactivateUser,
  assertCanSuspendUser,
  type UserStatus,
} from '../status.js';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import {
  findEmailByNormalized,
  findPrimaryEmailForUser,
  findUserById,
  insertEmailAddress,
  insertMembership,
  insertUser,
  recordLifecycleEvent,
  updateUserWithExpectedVersion,
} from '../repository/users.js';
import {
  findInvitationByTokenHash,
  insertInvitation,
  markInvitationAccepted,
} from '../repository/invitations.js';
import { insertPasswordCredential } from '../repository/credentials.js';
import { revokeAllSessionsForUser } from '../repository/sessions.js';
import type { TransactionClient } from '../tx.js';

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Invitation creation is a platform-operator-scoped, cross-tenant action -
 * exactly like SP001's organization creation, and for the identical
 * structural reason: it is not yet possible for an ordinary authenticated
 * user to be authorized to invite anyone into an organization (that is
 * SP008's role/permission model). This command exists, is real, and is
 * integration-tested directly, but has no HTTP endpoint wired to it in
 * this prompt - see docs/architecture/identity-model.md.
 */
export interface CreateInvitationInput {
  scope: TrustedScope;
  organizationId: string;
  email: string;
  idempotencyKey: string;
}

export interface CreateInvitationResult {
  invitationId: string;
  /** Raw, unhashed token - returned exactly once, at creation. Delivery is the caller's job (outbox event), never logged here. */
  rawToken: string;
  expiresAt: string;
}

export async function createInvitation(
  db: NodePgDatabase,
  input: CreateInvitationInput,
): Promise<CommandResponse<CreateInvitationResult>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError(
      'Only a platform operator may create invitations in this prompt.',
    );
  }
  const scope: PlatformOperatorScope = input.scope;
  const emailNormalized = normalizeEmail(input.email);

  return runIdempotentCommand(
    db,
    null,
    scope.actor.actorId,
    'CreateInvitation',
    input.idempotencyKey,
    { organizationId: input.organizationId, email: emailNormalized },
    async (tx) => {
      const rawToken = generateOpaqueToken();
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

      const invitation = await insertInvitation(tx, {
        organizationId: input.organizationId,
        emailNormalized,
        tokenHash,
        invitedBy: scope.actor.actorId,
        expiresAt,
      });

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'invitation.create',
        targetType: 'UserInvitation',
        targetId: invitation.id,
        newVersion: invitation.version,
        newState: invitation.status,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
        changedFields: { emailNormalized },
      });
      await recordOutboxEvent(tx, {
        aggregateType: 'UserInvitation',
        aggregateId: invitation.id,
        organizationId: input.organizationId,
        eventType: 'invitation.created',
        aggregateVersion: invitation.version,
        payload: { id: invitation.id, organizationId: input.organizationId },
        correlationId: scope.correlationId,
      });

      return {
        status: 201,
        body: { invitationId: invitation.id, rawToken, expiresAt: expiresAt.toISOString() },
      };
    },
    input.organizationId,
  );
}

export interface AcceptInvitationInput {
  token: string;
  displayName: string;
  password: string;
  idempotencyKey: string;
  correlationId: string;
  requestId: string;
}

/**
 * Concurrency-safe: `markInvitationAccepted`'s conditional
 * `WHERE status = 'PENDING'` ensures exactly one of two simultaneous
 * accept attempts for the same token can ever create a user/membership.
 */
export async function acceptInvitation(
  db: NodePgDatabase,
  input: AcceptInvitationInput,
): Promise<CommandResponse<UserDto>> {
  const tokenHash = hashToken(input.token);

  const passwordPolicyResult = validatePasswordPolicy(input.password);
  if (!passwordPolicyResult.ok) {
    throw new DomainValidationError(passwordPolicyResult.reason, [
      { field: 'password', message: passwordPolicyResult.reason },
    ]);
  }

  return runIdempotentCommand(
    db,
    null,
    `invitation:${tokenHash.slice(0, 16)}`,
    'AcceptInvitation',
    input.idempotencyKey,
    { tokenHash },
    async (tx) => {
      const invitation = await findInvitationByTokenHash(tx, tokenHash);
      if (
        !invitation ||
        invitation.status !== 'PENDING' ||
        invitation.expiresAt.getTime() < Date.now()
      ) {
        throw new InvalidOrExpiredTokenError();
      }

      // The organization isn't known until the token is resolved above, so
      // it cannot be passed as `runIdempotentCommand`'s `auditOrganizationId`
      // parameter up front - set it here instead, for the rest of this same
      // transaction, so the audit/outbox writes below (which legitimately
      // carry this organization_id) satisfy those shared tables' RLS.
      assertValidUuid(invitation.organizationId, 'invitation.organizationId');
      await tx.execute(
        sql.raw(`SET LOCAL app.current_organization_id = '${invitation.organizationId}'`),
      );

      const existingEmail = await findEmailByNormalized(tx, invitation.emailNormalized);
      let userId: string;
      if (existingEmail) {
        // An existing identity accepting an invitation into a NEW
        // organization - no new user row, just a new membership.
        userId = existingEmail.userId;
      } else {
        const user = await insertUser(tx, {
          status: 'ACTIVE',
          displayName: input.displayName,
          createdBy: 'invitation-accept',
          updatedBy: 'invitation-accept',
        });
        userId = user.id;
        assertCanActivateUser('INVITED');
        await recordLifecycleEvent(tx, {
          userId,
          fromStatus: null,
          toStatus: 'ACTIVE',
          reason: 'invitation accepted',
          actorId: 'invitation-accept',
        });
        await insertEmailAddress(tx, {
          userId,
          emailNormalized: invitation.emailNormalized,
          emailOriginal: invitation.emailNormalized,
          isPrimary: true,
          verifiedAt: new Date(), // accepting via a token emailed to this address IS the verification event
        });
        const passwordHash = await hashPassword(normalizePassword(input.password));
        await insertPasswordCredential(tx, { userId, passwordHash });
      }

      const accepted = await markInvitationAccepted(tx, invitation.id, userId);
      if (!accepted) {
        throw new InvalidOrExpiredTokenError();
      }

      await insertMembership(tx, {
        userId,
        organizationId: invitation.organizationId,
        createdBy: 'invitation-accept',
        updatedBy: 'invitation-accept',
      });

      await recordAuditEvent(tx, {
        organizationId: invitation.organizationId,
        actorId: userId,
        actorType: 'user',
        action: 'invitation.accepted',
        targetType: 'UserInvitation',
        targetId: invitation.id,
        newState: 'ACCEPTED',
        correlationId: input.correlationId,
        requestId: input.requestId,
      });
      await recordOutboxEvent(tx, {
        aggregateType: 'UserInvitation',
        aggregateId: invitation.id,
        organizationId: invitation.organizationId,
        eventType: 'invitation.accepted',
        aggregateVersion: accepted.version,
        payload: { id: invitation.id, userId, organizationId: invitation.organizationId },
        correlationId: input.correlationId,
      });

      const user = await findUserById(tx, userId);
      if (!user)
        throw new Error('acceptInvitation: user disappeared inside its own creating transaction.');
      const primaryEmail = await findPrimaryEmailForUser(tx, userId);
      return {
        status: 200,
        body: toUserDto(
          user,
          primaryEmail
            ? { emailOriginal: primaryEmail.emailOriginal, verifiedAt: primaryEmail.verifiedAt }
            : undefined,
        ),
      };
    },
  );
}

// ---------------------------------------------------------------------
// Admin lifecycle - real, integration-tested, no HTTP endpoint in this
// prompt (see module doc comment above).
// ---------------------------------------------------------------------

export interface UserLifecycleInput {
  scope: TrustedScope;
  userId: string;
  expectedVersion: number;
  reason?: string;
  idempotencyKey: string;
}

async function runUserLifecycleCommand(
  db: NodePgDatabase,
  input: UserLifecycleInput,
  operationName: string,
  action: string,
  newStatus: Extract<UserStatus, 'SUSPENDED' | 'ACTIVE' | 'DEACTIVATED'>,
  assertTransition: (current: UserStatus) => void,
  timestampField: 'suspendedAt' | 'reactivatedAt' | 'deactivatedAt',
): Promise<CommandResponse<UserDto>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError(
      "Only a platform operator may change another user's lifecycle status in this prompt.",
    );
  }
  const scope = input.scope;

  return runIdempotentCommand(
    db,
    null,
    scope.actor.actorId,
    operationName,
    input.idempotencyKey,
    { userId: input.userId, expectedVersion: input.expectedVersion, reason: input.reason },
    async (tx: TransactionClient) => {
      const current = await findUserById(tx, input.userId);
      if (!current) throw new DomainNotFoundError('User', input.userId);
      assertTransition(current.status as UserStatus);

      const bumpSecurityStamp = newStatus === 'SUSPENDED' || newStatus === 'DEACTIVATED';
      const updated = await updateUserWithExpectedVersion(tx, input.userId, input.expectedVersion, {
        status: newStatus,
        statusReason: input.reason ?? null,
        updatedBy: scope.actor.actorId,
        [timestampField]: new Date(),
        ...(bumpSecurityStamp ? { securityStamp: randomUUID() } : {}),
      });

      if (bumpSecurityStamp) {
        await revokeAllSessionsForUser(tx, input.userId, `user.${newStatus.toLowerCase()}`);
      }

      await recordLifecycleEvent(tx, {
        userId: input.userId,
        fromStatus: current.status,
        toStatus: newStatus,
        reason: input.reason ?? null,
        actorId: scope.actor.actorId,
      });
      await recordAuditEvent(tx, {
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action,
        targetType: 'User',
        targetId: updated.id,
        previousVersion: current.version,
        previousState: current.status,
        newVersion: updated.version,
        newState: updated.status,
        reason: input.reason ?? null,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
      });
      await recordOutboxEvent(tx, {
        aggregateType: 'User',
        aggregateId: updated.id,
        eventType: `user.${newStatus.toLowerCase()}`,
        aggregateVersion: updated.version,
        payload: { id: updated.id, status: updated.status },
        correlationId: scope.correlationId,
      });

      const primaryEmail = await findPrimaryEmailForUser(tx, updated.id);
      return {
        status: 200,
        body: toUserDto(
          updated,
          primaryEmail
            ? { emailOriginal: primaryEmail.emailOriginal, verifiedAt: primaryEmail.verifiedAt }
            : undefined,
        ),
      };
    },
  );
}

export function suspendUser(
  db: NodePgDatabase,
  input: UserLifecycleInput,
): Promise<CommandResponse<UserDto>> {
  return runUserLifecycleCommand(
    db,
    input,
    'SuspendUser',
    'user.suspend',
    'SUSPENDED',
    assertCanSuspendUser,
    'suspendedAt',
  );
}

export function reactivateUser(
  db: NodePgDatabase,
  input: UserLifecycleInput,
): Promise<CommandResponse<UserDto>> {
  return runUserLifecycleCommand(
    db,
    input,
    'ReactivateUser',
    'user.reactivate',
    'ACTIVE',
    assertCanReactivateUser,
    'reactivatedAt',
  );
}

export function deactivateUser(
  db: NodePgDatabase,
  input: UserLifecycleInput,
): Promise<CommandResponse<UserDto>> {
  return runUserLifecycleCommand(
    db,
    input,
    'DeactivateUser',
    'user.deactivate',
    'DEACTIVATED',
    assertCanDeactivateUser,
    'deactivatedAt',
  );
}
