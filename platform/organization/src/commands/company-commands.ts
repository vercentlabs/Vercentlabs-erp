import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  DomainForbiddenError,
  DomainNotFoundError,
  DomainValidationError,
  isOrganizationScope,
  type CompanyDto,
  type CompanyLifecycleReasonRequest,
  type CompanyStatus,
  type CreateCompanyRequest,
  type OrganizationScope,
  type TrustedScope,
  type UpdateCompanyRequest,
} from '@vercentlabs/contracts';
import { recordAuditEvent } from '@vercentlabs/platform-audit';
import { recordOutboxEvent } from '@vercentlabs/platform-outbox';
import { runIdempotentCommand, type CommandResponse } from '../command-helpers.js';
import { toCompanyDto } from '../mappers.js';
import { loadOrganizationAcceptingNewCompanies } from '../organization-guard.js';
import {
  findCompanyByCode,
  findCompanyById,
  insertCompany,
  updateCompanyWithExpectedVersion,
} from '../repository.js';
import {
  assertCanActivateCompany,
  assertCanCloseCompany,
  assertCanDeactivateCompany,
  assertCanReactivateCompany,
  assertCanUpdateCompanyMetadata,
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

async function loadCompanyInScope(
  tx: Parameters<typeof findCompanyById>[0],
  scope: OrganizationScope,
  companyId: string,
) {
  const company = await findCompanyById(tx, companyId);
  if (!company || company.organizationId !== scope.organizationId) {
    // Identical response whether the id is unknown or belongs to another
    // organization - RLS already guarantees the SELECT itself returns no
    // row for another org's company; this check also protects the (rare)
    // path where a caller queries by primary key outside RLS-scoped SQL.
    throw new DomainNotFoundError('Company', companyId);
  }
  return company;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateCompanyInput {
  scope: TrustedScope;
  request: CreateCompanyRequest;
  idempotencyKey: string;
}

export async function createCompany(
  db: NodePgDatabase,
  input: CreateCompanyInput,
): Promise<CommandResponse<CompanyDto>> {
  if (!isOrganizationScope(input.scope)) {
    throw new DomainForbiddenError(
      'Creating a company requires an organization-scoped trusted context.',
    );
  }
  const scope = input.scope;

  // Checked before claiming an Idempotency-Key: a request against a
  // nonexistent/non-accepting organization is fundamentally invalid and
  // must never record an idempotency attempt (whose own organization_id
  // foreign key would otherwise fail with a raw constraint violation
  // instead of this typed error).
  await loadOrganizationAcceptingNewCompanies(db, scope.organizationId);

  return runIdempotentCommand(
    db,
    scope.organizationId,
    scope.actor.actorId,
    'CreateCompany',
    input.idempotencyKey,
    input.request,
    async (tx) => {
      const existing = await findCompanyByCode(tx, scope.organizationId, input.request.companyCode);
      if (existing) {
        throw new DomainValidationError(
          `companyCode "${input.request.companyCode}" is already in use.`,
          [{ field: 'companyCode', message: 'already in use' }],
        );
      }

      const row = await insertCompany(tx, {
        organizationId: scope.organizationId,
        companyCode: input.request.companyCode,
        legalName: input.request.legalName,
        displayName: input.request.displayName,
        countryCode: input.request.countryCode,
        baseCurrency: input.request.baseCurrency,
        timeZone: input.request.timeZone,
        taxRegistrations: input.request.taxRegistrations ?? [],
        createdBy: scope.actor.actorId,
        updatedBy: scope.actor.actorId,
      });

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        companyId: row.id,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'company.create',
        targetType: 'Company',
        targetId: row.id,
        newVersion: row.version,
        newState: row.status,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
        changedFields: { companyCode: row.companyCode, displayName: row.displayName },
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'Company',
        aggregateId: row.id,
        organizationId: scope.organizationId,
        eventType: 'company.created',
        aggregateVersion: row.version,
        payload: {
          id: row.id,
          organizationId: row.organizationId,
          companyCode: row.companyCode,
          status: row.status,
        },
        correlationId: scope.correlationId,
      });

      return { status: 201, body: toCompanyDto(row) };
    },
  );
}

// ---------------------------------------------------------------------------
// Update editable metadata
// ---------------------------------------------------------------------------

export interface UpdateCompanyInput {
  scope: TrustedScope;
  organizationId: string;
  companyId: string;
  expectedVersion: number;
  request: UpdateCompanyRequest;
  idempotencyKey: string;
}

export async function updateCompany(
  db: NodePgDatabase,
  input: UpdateCompanyInput,
): Promise<CommandResponse<CompanyDto>> {
  const scope = requireOrganizationScopeMatching(input.scope, input.organizationId);

  return runIdempotentCommand(
    db,
    scope.organizationId,
    scope.actor.actorId,
    'UpdateCompany',
    input.idempotencyKey,
    { companyId: input.companyId, expectedVersion: input.expectedVersion, request: input.request },
    async (tx) => {
      const current = await loadCompanyInScope(tx, scope, input.companyId);
      assertCanUpdateCompanyMetadata(current.status as CompanyStatus);

      const updated = await updateCompanyWithExpectedVersion(
        tx,
        input.companyId,
        input.expectedVersion,
        {
          ...(input.request.legalName !== undefined ? { legalName: input.request.legalName } : {}),
          ...(input.request.displayName !== undefined
            ? { displayName: input.request.displayName }
            : {}),
          ...(input.request.timeZone !== undefined ? { timeZone: input.request.timeZone } : {}),
          ...(input.request.taxRegistrations !== undefined
            ? { taxRegistrations: input.request.taxRegistrations }
            : {}),
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        companyId: updated.id,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action: 'company.update_metadata',
        targetType: 'Company',
        targetId: updated.id,
        previousVersion: current.version,
        newVersion: updated.version,
        correlationId: scope.correlationId,
        requestId: scope.requestId,
        changedFields: input.request as Record<string, unknown>,
      });

      await recordOutboxEvent(tx, {
        aggregateType: 'Company',
        aggregateId: updated.id,
        organizationId: scope.organizationId,
        eventType: 'company.metadata_updated',
        aggregateVersion: updated.version,
        payload: { id: updated.id, displayName: updated.displayName },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toCompanyDto(updated) };
    },
  );
}

// ---------------------------------------------------------------------------
// Lifecycle: activate / deactivate / reactivate / close
// ---------------------------------------------------------------------------

interface CompanyLifecycleInput {
  scope: TrustedScope;
  organizationId: string;
  companyId: string;
  expectedVersion: number;
  idempotencyKey: string;
}

interface CompanyLifecycleWithReasonInput extends CompanyLifecycleInput {
  request: CompanyLifecycleReasonRequest;
}

async function runCompanyLifecycleCommand(
  db: NodePgDatabase,
  input: CompanyLifecycleInput,
  operationName: string,
  action: string,
  newStatus: CompanyStatus,
  reason: string | null,
  assertTransition: (current: CompanyStatus) => void,
): Promise<CommandResponse<CompanyDto>> {
  const scope = requireOrganizationScopeMatching(input.scope, input.organizationId);

  return runIdempotentCommand(
    db,
    scope.organizationId,
    scope.actor.actorId,
    operationName,
    input.idempotencyKey,
    { companyId: input.companyId, expectedVersion: input.expectedVersion, reason },
    async (tx) => {
      const current = await loadCompanyInScope(tx, scope, input.companyId);
      assertTransition(current.status as CompanyStatus);

      const updated = await updateCompanyWithExpectedVersion(
        tx,
        input.companyId,
        input.expectedVersion,
        {
          status: newStatus,
          statusReason: reason,
          updatedBy: scope.actor.actorId,
        },
      );

      await recordAuditEvent(tx, {
        organizationId: scope.organizationId,
        companyId: updated.id,
        actorId: scope.actor.actorId,
        actorType: scope.actor.actorType,
        action,
        targetType: 'Company',
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
        aggregateType: 'Company',
        aggregateId: updated.id,
        organizationId: scope.organizationId,
        eventType: `company.${newStatus.toLowerCase()}`,
        aggregateVersion: updated.version,
        payload: { id: updated.id, status: updated.status },
        correlationId: scope.correlationId,
      });

      return { status: 200, body: toCompanyDto(updated) };
    },
  );
}

export function activateCompany(
  db: NodePgDatabase,
  input: CompanyLifecycleInput,
): Promise<CommandResponse<CompanyDto>> {
  return runCompanyLifecycleCommand(
    db,
    input,
    'ActivateCompany',
    'company.activate',
    'ACTIVE',
    null,
    assertCanActivateCompany,
  );
}

export function deactivateCompany(
  db: NodePgDatabase,
  input: CompanyLifecycleWithReasonInput,
): Promise<CommandResponse<CompanyDto>> {
  return runCompanyLifecycleCommand(
    db,
    input,
    'DeactivateCompany',
    'company.deactivate',
    'INACTIVE',
    input.request.reason,
    assertCanDeactivateCompany,
  );
}

export function reactivateCompany(
  db: NodePgDatabase,
  input: CompanyLifecycleInput,
): Promise<CommandResponse<CompanyDto>> {
  return runCompanyLifecycleCommand(
    db,
    input,
    'ReactivateCompany',
    'company.reactivate',
    'ACTIVE',
    null,
    assertCanReactivateCompany,
  );
}

export function closeCompany(
  db: NodePgDatabase,
  input: CompanyLifecycleWithReasonInput,
): Promise<CommandResponse<CompanyDto>> {
  return runCompanyLifecycleCommand(
    db,
    input,
    'CloseCompany',
    'company.close',
    'CLOSED',
    input.request.reason,
    assertCanCloseCompany,
  );
}
