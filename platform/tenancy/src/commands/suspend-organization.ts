import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  isPlatformOperatorScope,
  type OrganizationDto,
  type OrganizationStatus,
  type SuspendOrganizationRequest,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { toOrganizationDto } from '../mappers.js';
import { assertCanSuspendOrganization } from '../status.js';
import { findOrganizationById, updateOrganizationWithExpectedVersion } from '../repository.js';

export interface SuspendOrganizationInput {
  scope: TrustedScope;
  organizationId: string;
  expectedVersion: number;
  request: SuspendOrganizationRequest;
  idempotencyKey: string;
}

export async function suspendOrganization(
  db: NodePgDatabase,
  input: SuspendOrganizationInput,
): Promise<CommandResponse<OrganizationDto>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError('Only a platform operator may suspend an organization.');
  }
  const scope = input.scope;

  return runIdempotentCommand(
    db,
    null,
    scope.actor.actorId,
    'SuspendOrganization',
    input.idempotencyKey,
    {
      organizationId: input.organizationId,
      expectedVersion: input.expectedVersion,
      request: input.request,
    },
    async (tx) => {
      const current = await findOrganizationById(tx, input.organizationId);
      if (!current) throw new DomainNotFoundError('Organization', input.organizationId);
      assertCanSuspendOrganization(current.status as OrganizationStatus);

      const updated = await updateOrganizationWithExpectedVersion(
        tx,
        input.organizationId,
        input.expectedVersion,
        {
          status: 'SUSPENDED',
          statusReason: input.request.reason,
          suspendedAt: new Date(),
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: null,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'organization.suspend',
        targetType: 'Organization',
        targetId: updated.id,
        previousVersion: current.version,
        previousState: current.status,
        newVersion: updated.version,
        newState: updated.status,
        reason: input.request.reason,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'Organization',
        aggregateId: updated.id,
        eventType: 'organization.suspended',
        aggregateVersion: updated.version,
        payload: { id: updated.id, status: updated.status, reason: input.request.reason },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toOrganizationDto(updated) };
    },
  );
}
