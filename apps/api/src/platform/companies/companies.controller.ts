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
  companyLifecycleReasonRequestSchema,
  companyStatusSchema,
  createCompanyRequestSchema,
  cursorPaginationRequestSchema,
  updateCompanyRequestSchema,
  type CompanyDto,
  type CursorPageResult,
  type TrustedScope,
} from '@vercentlabs/contracts';
import {
  activateCompany,
  closeCompany,
  createCompany,
  deactivateCompany,
  getCompany,
  listCompanies,
  reactivateCompany,
  updateCompany,
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
  status: companyStatusSchema.optional(),
  search: z.string().min(1).max(200).optional(),
});

/**
 * SP002 company lifecycle, nested under an organization. `organizationId`
 * always comes from the URL path (a target-resource reference, checked
 * against the trusted scope inside each domain command) - never from the
 * request body.
 */
@ApiTags('platform-companies')
@ApiSecurity('trusted-scope')
@UseGuards(TrustedScopeGuard)
@Controller('platform/organizations/:organizationId/companies')
export class CompaniesController {
  constructor(@Inject(PLATFORM_DB) private readonly db: NodePgDatabase) {}

  // `organizationId` is a target-resource reference only; createCompany
  // derives authorization from `scope.organizationId`, not this path param.
  // A caller whose scope doesn't match the path organization still gets a
  // consistent FORBIDDEN (the create itself is scope-authorized, not
  // path-authorized, since a brand-new company has no row to compare
  // against yet).
  @Post()
  @HttpCode(201)
  async create(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<CompanyDto> {
    requireScopeMatchesPath(scope, organizationId);
    const idempotencyKey = requireIdempotencyKey(request);
    const request_ = parseBody(createCompanyRequestSchema, body);
    const result = await createCompany(this.db, { scope, request: request_, idempotencyKey });
    return result.body;
  }

  @Get(':companyId')
  async getOne(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
  ): Promise<CompanyDto> {
    return getCompany(this.db, { scope, organizationId, companyId });
  }

  @Get()
  async list(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Query() query: unknown,
  ): Promise<CursorPageResult<CompanyDto>> {
    const parsed = stripUndefined(parseQuery(listQuerySchema, query));
    return listCompanies(this.db, { scope, organizationId, ...parsed });
  }

  @Patch(':companyId')
  async update(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<CompanyDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(updateCompanyRequestSchema, body);
    const result = await updateCompany(this.db, {
      scope,
      organizationId,
      companyId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':companyId/activate')
  @HttpCode(200)
  async activate(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
    @Req() request: FastifyRequest,
  ): Promise<CompanyDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const result = await activateCompany(this.db, {
      scope,
      organizationId,
      companyId,
      expectedVersion,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':companyId/deactivate')
  @HttpCode(200)
  async deactivate(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<CompanyDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(companyLifecycleReasonRequestSchema, body);
    const result = await deactivateCompany(this.db, {
      scope,
      organizationId,
      companyId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':companyId/reactivate')
  @HttpCode(200)
  async reactivate(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
    @Req() request: FastifyRequest,
  ): Promise<CompanyDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const result = await reactivateCompany(this.db, {
      scope,
      organizationId,
      companyId,
      expectedVersion,
      idempotencyKey,
    });
    return result.body;
  }

  @Post(':companyId/close')
  @HttpCode(200)
  async close(
    @CurrentTrustedScope() scope: TrustedScope,
    @Param('organizationId') organizationId: string,
    @Param('companyId') companyId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<CompanyDto> {
    const idempotencyKey = requireIdempotencyKey(request);
    const expectedVersion = requireExpectedVersion(request);
    const request_ = parseBody(companyLifecycleReasonRequestSchema, body);
    const result = await closeCompany(this.db, {
      scope,
      organizationId,
      companyId,
      expectedVersion,
      request: request_,
      idempotencyKey,
    });
    return result.body;
  }
}
