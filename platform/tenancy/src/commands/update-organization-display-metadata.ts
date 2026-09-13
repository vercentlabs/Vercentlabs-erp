import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  isPlatformOperatorScope,
  type OrganizationDto,
  type OrganizationStatus,
  type TrustedScope,
  type UpdateOrganizationDisplayMetadataRequest,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { toOrganizationDto } from '../mappers.js';
import { assertCanUpdateOrganizationMetadata } from '../status.js';
import { findOrganizationById, updateOrganizationWithExpectedVersion } from '../repository.js';

export interface UpdateOrganizationDisplayMetadataInput {
  scope: TrustedScope;
  organizationId: string;
  expectedVersion: number;
  request: UpdateOrganizationDisplayMetadataRequest;
  idempotencyKey: string;
}

export async function updateOrganizationDisplayMetadata(
  db: NodePgDatabase,
  input: UpdateOrganizationDisplayMetadataInput,
): Promise<CommandResponse<OrganizationDto>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError('Only a platform operator may update organization metadata.');
  }
  const scope = input.scope;

  return runIdempotentCommand(
    db,
    null,
    scope.actor.actorId,
    'UpdateOrganizationDisplayMetadata',
    input.idempotencyKey,
    {
      organizationId: input.organizationId,
      expectedVersion: input.expectedVersion,
      request: input.request,
    },
    async (tx) => {
      const current = await findOrganizationById(tx, input.organizationId);
      if (!current) throw new DomainNotFoundError('Organization', input.organizationId);
      assertCanUpdateOrganizationMetadata(current.status as OrganizationStatus);

      const updated = await updateOrganizationWithExpectedVersion(
        tx,
        input.organizationId,
        input.expectedVersion,
        {
          ...(input.request.displayName !== undefined
            ? { displayName: input.request.displayName }
            : {}),
          ...(input.request.legalMetadata !== undefined
            ? { legalMetadata: input.request.legalMetadata }
            : {}),
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: null,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'organization.update_display_metadata',
        targetType: 'Organization',
        targetId: updated.id,
        previousVersion: current.version,
        newVersion: updated.version,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
        changedFields: input.request as Record<string, unknown>,
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'Organization',
        aggregateId: updated.id,
        eventType: 'organization.display_metadata_updated',
        aggregateVersion: updated.version,
        payload: { id: updated.id, displayName: updated.displayName },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toOrganizationDto(updated) };
    },
  );
}
