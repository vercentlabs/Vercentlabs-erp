import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  DomainValidationError,
  isOrganizationScope,
  type CreateOperatingUnitRequest,
  type OperatingUnitDto,
  type OperatingUnitLifecycleReasonRequest,
  type OperatingUnitStatus,
  type OrganizationScope,
  type TrustedScope,
  type UpdateOperatingUnitRequest,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { toOperatingUnitDto } from '../mappers.js';
import { loadOrganizationAcceptingNewCompanies } from '../organization-guard.js';
import {
  findCompanyById,
  findOperatingUnitByCode,
  findOperatingUnitById,
  insertOperatingUnit,
  updateOperatingUnitWithExpectedVersion,
} from '../repository.js';
import {
  assertCanActivateOperatingUnit,
  assertCanCloseOperatingUnit,
  assertCanDeactivateOperatingUnit,
  assertCanReactivateOperatingUnit,
  assertCanUpdateOperatingUnitMetadata,
} from '../status.js';

function requireOrganizationScopeMatching(
  scope: TrustedScope,
  organizationId: string,
): OrganizationScope {
  if (!isOrganizationScope(scope) || scope.organizationId !== organizationId) {
    throw new DomainForbiddenError('This trusted scope is not authorized for this organization.');
  }
  return scope;
}

async function loadOperatingUnitInScope(
  tx: Parameters<typeof findOperatingUnitById>[0],
  scope: OrganizationScope,
  operatingUnitId: string,
) {
  const unit = await findOperatingUnitById(tx, operatingUnitId);
  if (!unit || unit.organizationId !== scope.organizationId) {
    throw new DomainNotFoundError('OperatingUnit', operatingUnitId);
  }
  return unit;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateOperatingUnitInput {
  scope: TrustedScope;
  companyId: string;
  request: CreateOperatingUnitRequest;
  idempotencyKey: string;
}

export async function createOperatingUnit(
  db: NodePgDatabase,
  input: CreateOperatingUnitInput,
): Promise<CommandResponse<OperatingUnitDto>> {
  if (!isOrganizationScope(input.scope)) {
    throw new DomainForbiddenError(
      'Creating an operating unit requires an organization-scoped trusted context.',
    );
  }
  const scope = input.scope;

  // See createCompany for why this runs before the idempotency claim.
  await loadOrganizationAcceptingNewCompanies(db, scope.organizationId);

  return runIdempotentCommand(
    db,
    scope.organizationId,
    scope.actor.actorId,
    'CreateOperatingUnit',
    input.idempotencyKey,
    { companyId: input.companyId, request: input.request },
    async (tx) => {
      const company = await findCompanyById(tx, input.companyId);
      if (!company || company.organizationId !== scope.organizationId) {
        throw new DomainNotFoundError('Company', input.companyId);
      }

      if (input.request.parentOperatingUnitId) {
        const parent = await findOperatingUnitById(tx, input.request.parentOperatingUnitId);
        if (
          !parent ||
          parent.organizationId !== scope.organizationId ||
          parent.companyId !== input.companyId
        ) {
          throw new DomainValidationError(
            'parentOperatingUnitId must belong to the same organization and company.',
            [{ field: 'parentOperatingUnitId', message: 'invalid parent' }],
          );
        }
      }

      const existing = await findOperatingUnitByCode(tx, input.companyId, input.request.unitCode);
      if (existing) {
        throw new DomainValidationError(`unitCode "${input.request.unitCode}" is already in use.`, [
          { field: 'unitCode', message: 'already in use' },
        ]);
      }

      const row = await insertOperatingUnit(tx, {
        organizationId: scope.organizationId,
        companyId: input.companyId,
        unitCode: input.request.unitCode,
        name: input.request.name,
        unitType: input.request.unitType,
        parentOperatingUnitId: input.request.parentOperatingUnitId ?? null,
        timeZone: input.request.timeZone,
        address: input.request.address ?? null,
        createdBy: scope.actor.actorId,
        updatedBy: scope.actor.actorId,
      });

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        companyId: input.companyId,
        operatingUnitId: row.id,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'operating_unit.create',
        targetType: 'OperatingUnit',
        targetId: row.id,
        newVersion: row.version,
        newState: row.status,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
        changedFields: { unitCode: row.unitCode, unitType: row.unitType, name: row.name },
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'OperatingUnit',
        aggregateId: row.id,
        organizationId: scope.organizationId,
        eventType: 'operating_unit.created',
        aggregateVersion: row.version,
        payload: {
          id: row.id,
          organizationId: row.organizationId,
          companyId: row.companyId,
          unitCode: row.unitCode,
        },
        correlationId: scope.correlationId,
      });

      return { status: 201, body: toOperatingUnitDto(row) };
    },
  );
}

// ---------------------------------------------------------------------------
// Update editable metadata
// ---------------------------------------------------------------------------

export interface UpdateOperatingUnitInput {
  scope: TrustedScope;
  organizationId: string;
  operatingUnitId: string;
  expectedVersion: number;
  request: UpdateOperatingUnitRequest;
  idempotencyKey: string;
}

export async function updateOperatingUnit(
  db: NodePgDatabase,
  input: UpdateOperatingUnitInput,
): Promise<CommandResponse<OperatingUnitDto>> {
  const scope = requireOrganizationScopeMatching(input.scope, input.organizationId);

  return runIdempotentCommand(
    db,
    scope.organizationId,
    scope.actor.actorId,
    'UpdateOperatingUnit',
    input.idempotencyKey,
    {
      operatingUnitId: input.operatingUnitId,
      expectedVersion: input.expectedVersion,
      request: input.request,
    },
    async (tx) => {
      const current = await loadOperatingUnitInScope(tx, scope, input.operatingUnitId);
      assertCanUpdateOperatingUnitMetadata(current.status as OperatingUnitStatus);

      const updated = await updateOperatingUnitWithExpectedVersion(
        tx,
        input.operatingUnitId,
        input.expectedVersion,
        {
          ...(input.request.name !== undefined ? { name: input.request.name } : {}),
          ...(input.request.timeZone !== undefined ? { timeZone: input.request.timeZone } : {}),
          ...(input.request.address !== undefined ? { address: input.request.address } : {}),
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        companyId: updated.companyId,
        operatingUnitId: updated.id,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'operating_unit.update_metadata',
        targetType: 'OperatingUnit',
        targetId: updated.id,
        previousVersion: current.version,
        newVersion: updated.version,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
        changedFields: input.request as Record<string, unknown>,
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'OperatingUnit',
        aggregateId: updated.id,
        organizationId: scope.organizationId,
        eventType: 'operating_unit.metadata_updated',
        aggregateVersion: updated.version,
        payload: { id: updated.id, name: updated.name },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toOperatingUnitDto(updated) };
    },
  );
}

// ---------------------------------------------------------------------------
// Lifecycle: activate / deactivate / reactivate / close
// ---------------------------------------------------------------------------

interface OperatingUnitLifecycleInput {
  scope: TrustedScope;
  organizationId: string;
  operatingUnitId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

interface OperatingUnitLifecycleWithReasonInput extends OperatingUnitLifecycleInput {
  request: OperatingUnitLifecycleReasonRequest;
}

async function runOperatingUnitLifecycleCommand(
  db: NodePgDatabase,
  input: OperatingUnitLifecycleInput,
  operationName: string,
  action: string,
  newStatus: OperatingUnitStatus,
  reason: string | null,
  assertTransition: (current: OperatingUnitStatus) => void,
): Promise<CommandResponse<OperatingUnitDto>> {
  const scope = requireOrganizationScopeMatching(input.scope, input.organizationId);

  return runIdempotentCommand(
    db,
    scope.organizationId,
    scope.actor.actorId,
    operationName,
    input.idempotencyKey,
    { operatingUnitId: input.operatingUnitId, expectedVersion: input.expectedVersion, reason },
    async (tx) => {
      const current = await loadOperatingUnitInScope(tx, scope, input.operatingUnitId);
      assertTransition(current.status as OperatingUnitStatus);

      const updated = await updateOperatingUnitWithExpectedVersion(
        tx,
        input.operatingUnitId,
        input.expectedVersion,
        {
          status: newStatus,
          statusReason: reason,
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        companyId: updated.companyId,
        operatingUnitId: updated.id,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action,
        targetType: 'OperatingUnit',
        targetId: updated.id,
        previousVersion: current.version,
        previousState: current.status,
        newVersion: updated.version,
        newState: updated.status,
        reason,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'OperatingUnit',
        aggregateId: updated.id,
        organizationId: scope.organizationId,
        eventType: `operating_unit.${newStatus.toLowerCase()}`,
        aggregateVersion: updated.version,
        payload: { id: updated.id, status: updated.status },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toOperatingUnitDto(updated) };
    },
  );
}

export function activateOperatingUnit(
  db: NodePgDatabase,
  input: OperatingUnitLifecycleInput,
): Promise<CommandResponse<OperatingUnitDto>> {
  return runOperatingUnitLifecycleCommand(
    db,
    input,
    'ActivateOperatingUnit',
    'operating_unit.activate',
    'ACTIVE',
    null,
    assertCanActivateOperatingUnit,
  );
}

export function deactivateOperatingUnit(
  db: NodePgDatabase,
  input: OperatingUnitLifecycleWithReasonInput,
): Promise<CommandResponse<OperatingUnitDto>> {
  return runOperatingUnitLifecycleCommand(
    db,
    input,
    'DeactivateOperatingUnit',
    'operating_unit.deactivate',
    'INACTIVE',
    input.request.reason,
    assertCanDeactivateOperatingUnit,
  );
}

export function reactivateOperatingUnit(
  db: NodePgDatabase,
  input: OperatingUnitLifecycleInput,
): Promise<CommandResponse<OperatingUnitDto>> {
  return runOperatingUnitLifecycleCommand(
    db,
    input,
    'ReactivateOperatingUnit',
    'operating_unit.reactivate',
    'ACTIVE',
    null,
    assertCanReactivateOperatingUnit,
  );
}

export function closeOperatingUnit(
  db: NodePgDatabase,
  input: OperatingUnitLifecycleWithReasonInput,
): Promise<CommandResponse<OperatingUnitDto>> {
  return runOperatingUnitLifecycleCommand(
    db,
    input,
    'CloseOperatingUnit',
    'operating_unit.close',
    'CLOSED',
    input.request.reason,
    assertCanCloseOperatingUnit,
  );
}
