import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import {
  closeOrganizationRequestSchema,
  createOrganizationRequestSchema,
  cursorPaginationRequestSchema,
  organizationStatusSchema,
  recoverOrganizationRequestSchema,
  suspendOrganizationRequestSchema,
  updateOrganizationDisplayMetadataRequestSchema,
  type OrganizationDto,
  type TrustedScope,
} from '@vercentlabs/contracts';
import type { CursorPageResult } from '@vercentlabs/contracts';
import {
  activateOrganization,
  closeOrganization,
  createOrganization,
  getOrganization,
  listOrganizations,
  recoverOrganization,
  suspendOrganization,
  updateOrganizationDisplayMetadata,
} from '@vercentlabs/platform-tenancy';
import { z } from 'zod';
import { CurrentTrustedScope } from '../auth/trusted-scope.decorator.js';
import { TrustedScopeGuard } from '../auth/trusted-scope.guard.js';
import { PLATFORM_ADMIN_DB } from '../database/platform-admin-database.service.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  parseBody,
  parseQuery,
  requireExpectedVersion,
  requireIdempotencyKey,
  stripUndefined,
} from '../http/http-inputs.js';
import type { FastifyRequest } from 'fastify';

const listQuerySchema = cursorPaginationRequestSchema.extend({
  status: organizationStatusSchema.optional(),
  search: z.string().min(1).max(200).optional(),
});

/**
 * SP001 organization lifecycle - platform-operator scoped only. There is no
 * client-supplied `organizationId`/actor anywhere in these bodies; the
 * trusted scope resolved by `TrustedScopeGuard` is the sole source of
 * identity and authorization (root governance rule 6).
 *
 * Injects `PLATFORM_ADMIN_DB` (the `erp_platform_admin` role), not
 * `PLATFORM_DB` - organization control-plane writes are database-role
 * distinct from ordinary tenant-runtime queries, per
 * database/migrations/platform/0007_harden_organizations_tenant_boundary.sql
 * and docs/security/platform-operator-boundary.md. This choice is fixed at
 * startup by which token this constructor asks for, never by anything in
 * the request.
 */
@ApiTags('platform-organizations')
@ApiSecurity('trusted-scope')
@UseGuards(TrustedScopeGuard)
@Controller('platform/organizations')
export class OrganizationsController {
  constructor(@Inject(PLATFORM_ADMIN_DB) private readonly db: NodePgDatabase) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentTrustedScope() scope: TrustedScope,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const request_ = parseBody(createOrganizationRequestSchema, body);
    const result = await createOrganization(this.db, { scope, request: request_, idempotencyKey });
    return result.body;
  }

  @Get(':organizationId')
  async getOne(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
  ): Promise<OrganizationDto> {
    return getOrganization(this.db, { scope, organizationId });
  }

  @Get()
  async list(
    @CurrentTrustedScope() scope: TrustedScope,
    @Query() query: unknown,
  ): Promise<CursorPageResult<OrganizationDto>> {
    const parsed = stripUndefined(parseQuery(listQuerySchema, query));
    return listOrganizations(this.db, { scope, ...parsed });
  }

  @Patch(':organizationId')
  async updateDisplayMetadata(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(updateOrganizationDisplayMetadataRequestSchema, body);
    const result = await updateOrganizationDisplayMetadata(this.db, {
      scope,
      organizationId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':organizationId/activate')
  @HttpCode(200)
  async activate(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const result = await activateOrganization(this.db, {
      scope,
      organizationId,
      expectedVersion,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':organizationId/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(suspendOrganizationRequestSchema, body);
    const result = await suspendOrganization(this.db, {
      scope,
      organizationId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':organizationId/recover')
  @HttpCode(200)
  async recover(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(recoverOrganizationRequestSchema, body);
    const result = await recoverOrganization(this.db, {
      scope,
      organizationId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':organizationId/close')
  @HttpCode(200)
  async close(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OrganizationDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(closeOrganizationRequestSchema, body);
    const result = await closeOrganization(this.db, {
      scope,
      organizationId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }
}
