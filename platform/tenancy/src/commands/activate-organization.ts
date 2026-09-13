import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  isPlatformOperatorScope,
  type OrganizationDto,
  type OrganizationStatus,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { toOrganizationDto } from '../mappers.js';
import { assertCanActivateOrganization } from '../status.js';
import { findOrganizationById, updateOrganizationWithExpectedVersion } from '../repository.js';

export interface ActivateOrganizationInput {
  scope: TrustedScope;
  organizationId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

export async function activateOrganization(
  db: NodePgDatabase,
  input: ActivateOrganizationInput,
): Promise<CommandResponse<OrganizationDto>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError('Only a platform operator may activate an organization.');
  }
  const scope = input.scope;

  return runIdempotentCommand(
    db,
    null,
    scope.actor.actorId,
    'ActivateOrganization',
    input.idempotencyKey,
    { organizationId: input.organizationId, expectedVersion: input.expectedVersion },
    async (tx) => {
      const current = await findOrganizationById(tx, input.organizationId);
      if (!current) throw new DomainNotFoundError('Organization', input.organizationId);
      assertCanActivateOrganization(current.status as OrganizationStatus);

      const updated = await updateOrganizationWithExpectedVersion(
        tx,
        input.organizationId,
        input.expectedVersion,
        {
          status: 'ACTIVE',
          statusReason: null,
          activatedAt: new Date(),
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: null,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'organization.activate',
        targetType: 'Organization',
        targetId: updated.id,
        previousVersion: current.version,
        previousState: current.status,
        newVersion: updated.version,
        newState: updated.status,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'Organization',
        aggregateId: updated.id,
        eventType: 'organization.activated',
        aggregateVersion: updated.version,
        payload: { id: updated.id, status: updated.status },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toOrganizationDto(updated) };
    },
  );
}
