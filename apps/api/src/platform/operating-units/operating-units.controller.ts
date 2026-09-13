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
  createOperatingUnitRequestSchema,
  cursorPaginationRequestSchema,
  operatingUnitLifecycleReasonRequestSchema,
  operatingUnitStatusSchema,
  updateOperatingUnitRequestSchema,
  type CursorPageResult,
  type OperatingUnitDto,
  type TrustedScope,
} from '@vercentlabs/contracts';
import {
  activateOperatingUnit,
  closeOperatingUnit,
  createOperatingUnit,
  deactivateOperatingUnit,
  getOperatingUnit,
  listOperatingUnits,
  reactivateOperatingUnit,
  resolveOperatingUnitChildren,
  updateOperatingUnit,
} from '@vercentlabs/platform-organization';
import { z } from 'zod';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { FastifyRequest } from 'fastify';
import { CurrentTrustedScope } from '../auth/trusted-scope.decorator.js';
import { TrustedScopeGuard } from '../auth/trusted-scope.guard.js';
import { PLATFORM_DB } from '../database/platform-database.service.js';
import {
  parseBody,
  parseQuery,
  requireExpectedVersion,
  requireIdempotencyKey,
  requireScopeMatchesPath,
  stripUndefined,
} from '../http/http-inputs.js';

const listQuerySchema = cursorPaginationRequestSchema.extend({
  status: operatingUnitStatusSchema.optional(),
  search: z.string().min(1).max(200).optional(),
});

/**
 * SP003 branch/site/operating-unit lifecycle, nested under an organization
 * and company. Both `organizationId` and `companyId` in the URL are
 * target-resource references only, checked against the trusted scope (and,
 * for `companyId`, against the loaded row) inside the domain layer - never
 * treated as authorization inputs by themselves.
 */
@ApiTags('platform-operating-units')
@ApiSecurity('trusted-scope')
@UseGuards(TrustedScopeGuard)
@Controller('platform/organizations/:organizationId/companies/:companyId/operating-units')
export class OperatingUnitsController {
  constructor(@Inject(PLATFORM_DB) private readonly db: NodePgDatabase) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OperatingUnitDto> {
    requireScopeMatchesPath(scope, organizationId);
    const idempotencyKey = requireIdempotencyKey(request);
    const request_ = parseBody(createOperatingUnitRequestSchema, body);
    const result = await createOperatingUnit(this.db, {
      scope,
      companyId,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Get(':operatingUnitId')
  async getOne(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('operatingUnitId') operatingUnitId: string,
  ): Promise<OperatingUnitDto> {
    return getOperatingUnit(this.db, { scope, organizationId, operatingUnitId });
  }

  @Get()
  async list(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
    @Query() query: unknown,
  ): Promise<CursorPageResult<OperatingUnitDto>> {
    const parsed = stripUndefined(parseQuery(listQuerySchema, query));
    return listOperatingUnits(this.db, { scope, organizationId, companyId, ...parsed });
  }

  @Get(':operatingUnitId/children')
  async children(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('operatingUnitId') operatingUnitId: string,
  ): Promise<OperatingUnitDto[]> {
    return resolveOperatingUnitChildren(this.db, { scope, organizationId, operatingUnitId });
  }

  @Patch(':operatingUnitId')
  async update(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('operatingUnitId') operatingUnitId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OperatingUnitDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(updateOperatingUnitRequestSchema, body);
    const result = await updateOperatingUnit(this.db, {
      scope,
      organizationId,
      operatingUnitId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':operatingUnitId/activate')
  @HttpCode(200)
  async activate(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('operatingUnitId') operatingUnitId: string,
    @Req() request: FastifyRequest,
  ): Promise<OperatingUnitDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const result = await activateOperatingUnit(this.db, {
      scope,
      organizationId,
      operatingUnitId,
      expectedVersion,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':operatingUnitId/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('operatingUnitId') operatingUnitId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OperatingUnitDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(operatingUnitLifecycleReasonRequestSchema, body);
    const result = await deactivateOperatingUnit(this.db, {
      scope,
      organizationId,
      operatingUnitId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':operatingUnitId/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('operatingUnitId') operatingUnitId: string,
    @Req() request: FastifyRequest,
  ): Promise<OperatingUnitDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const result = await reactivateOperatingUnit(this.db, {
      scope,
      organizationId,
      operatingUnitId,
      expectedVersion,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':operatingUnitId/close')
  @HttpCode(200)
  async close(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('operatingUnitId') operatingUnitId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<OperatingUnitDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(operatingUnitLifecycleReasonRequestSchema, body);
    const result = await closeOperatingUnit(this.db, {
      scope,
      organizationId,
      operatingUnitId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }
}
