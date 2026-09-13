import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  isPlatformOperatorScope,
  type OrganizationDto,
  type OrganizationStatus,
  type RecoverOrganizationRequest,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { toOrganizationDto } from '../mappers.js';
import { assertCanRecoverOrganization } from '../status.js';
import { findOrganizationById, updateOrganizationWithExpectedVersion } from '../repository.js';

export interface RecoverOrganizationInput {
  scope: TrustedScope;
  organizationId: string;
  expectedVersion: number;
  request: RecoverOrganizationRequest;
  idempotencyKey: string;
}

/** Recovery is explicit, permissioned, version-safe and audited (SP001) - a distinct command from activate, even though both land on ACTIVE. */
export async function recoverOrganization(
  db: NodePgDatabase,
  input: RecoverOrganizationInput,
): Promise<CommandResponse<OrganizationDto>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError('Only a platform operator may recover an organization.');
  }
  const scope = input.scope;

  return runIdempotentCommand(
    db,
    null,
    scope.actor.actorId,
    'RecoverOrganization',
    input.idempotencyKey,
    {
      organizationId: input.organizationId,
      expectedVersion: input.expectedVersion,
      request: input.request,
    },
    async (tx) => {
      const current = await findOrganizationById(tx, input.organizationId);
      if (!current) throw new DomainNotFoundError('Organization', input.organizationId);
      assertCanRecoverOrganization(current.status as OrganizationStatus);

      const updated = await updateOrganizationWithExpectedVersion(
        tx,
        input.organizationId,
        input.expectedVersion,
        {
          status: 'ACTIVE',
          statusReason: input.request.reason,
          recoveredAt: new Date(),
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: null,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'organization.recover',
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
        eventType: 'organization.recovered',
        aggregateVersion: updated.version,
        payload: { id: updated.id, status: updated.status, reason: input.request.reason },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toOrganizationDto(updated) };
    },
  );
}
