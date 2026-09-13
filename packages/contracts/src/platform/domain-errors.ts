/**
 * Framework-free domain error vocabulary shared by every platform domain
 * package (platform/tenancy, platform/organization, ...) and mapped by
 * apps/api's HTTP layer onto the typed {@link import('../error.js').ErrorCode}
 * contract. Domain packages must never import NestJS/HTTP types - this is
 * the seam that keeps them framework-agnostic while still producing a
 * consistent API error shape.
 */

export class DomainValidationError extends Error {
  constructor(
    message: string,
    public readonly details?: { field?: string; message: string }[],
  ) {
    super(message);
    this.name = 'DomainValidationError';
  }
}

export class DomainNotFoundError extends Error {
  constructor(
    public readonly resourceType: string,
    public readonly resourceId: string,
  ) {
    super(`${resourceType} "${resourceId}" was not found.`);
    this.name = 'DomainNotFoundError';
  }
}

export class DomainForbiddenError extends Error {
  constructor(message = 'This operation is not permitted for the current trusted scope.') {
    super(message);
    this.name = 'DomainForbiddenError';
  }
}

/** An operation attempted a transition the state machine does not allow (e.g. CLOSED -> ACTIVE). */
export class StateTransitionConflictError extends Error {
  constructor(
    public readonly entityType: string,
    public readonly fromStatus: string,
    public readonly toStatus: string,
  ) {
    super(`${entityType} cannot transition from ${fromStatus} to ${toStatus}.`);
    this.name = 'StateTransitionConflictError';
  }
}

/** The caller's expected version did not match the current stored version - a lost update. */
export class StaleVersionConflictError extends Error {
  constructor(
    public readonly expectedVersion: number,
    public readonly actualVersion: number,
  ) {
    super(`Expected version ${expectedVersion} but the current version is ${actualVersion}.`);
    this.name = 'StaleVersionConflictError';
  }
}
