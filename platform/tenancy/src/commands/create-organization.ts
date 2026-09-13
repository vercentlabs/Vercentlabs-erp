import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainValidationError,
  isPlatformOperatorScope,
  type CreateOrganizationRequest,
  type OrganizationDto,
  type TrustedScope,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { toOrganizationDto } from '../mappers.js';
import { findOrganizationByTenantKey, insertOrganization } from '../repository.js';

export interface CreateOrganizationInput {
  scope: TrustedScope;
  request: CreateOrganizationRequest;
  idempotencyKey: string;
}

export async function createOrganization(
  db: NodePgDatabase,
  input: CreateOrganizationInput,
): Promise<CommandResponse<OrganizationDto>> {
  if (!isPlatformOperatorScope(input.scope)) {
    throw new DomainForbiddenError('Only a platform operator may create organizations.');
  }
  const scope = input.scope;

  return runIdempotentCommand(
    db,
    null,
    scope.actor.actorId,
    'CreateOrganization',
    input.idempotencyKey,
    input.request,
    async (tx) => {
      const existing = await findOrganizationByTenantKey(tx, input.request.tenantKey);
      if (existing) {
        throw new DomainValidationError(
          `tenantKey "${input.request.tenantKey}" is already in use.`,
          [{ field: 'tenantKey', message: 'already in use' }],
        );
      }

      const row = await insertOrganization(tx, {
        tenantKey: input.request.tenantKey,
        displayName: input.request.displayName,
        legalMetadata: input.request.legalMetadata ?? null,
        createdBy: scope.actor.actorId,
        updatedBy: scope.actor.actorId,
      });

      await recordAuditEvent(tx, {
        organizationId: null,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'organization.create',
        targetType: 'Organization',
        targetId: row.id,
        newVersion: row.version,
        newState: row.status,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
        changedFields: { tenantKey: row.tenantKey, displayName: row.displayName },
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'Organization',
        aggregateId: row.id,
        organizationId: null,
        eventType: 'organization.created',
        aggregateVersion: row.version,
        payload: {
          id: row.id,
          tenantKey: row.tenantKey,
          displayName: row.displayName,
          status: row.status,
        },
        correlationId: scope.correlationId,
      });

      return { status: 201, body: toOrganizationDto(row) };
    },
  );
}
