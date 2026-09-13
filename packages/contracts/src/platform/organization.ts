import { z } from 'zod';
import { normalizedCodeSchema, codeInputSchema } from './codes.js';

export const organizationStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'SUSPENDED', 'CLOSED']);
export type OrganizationStatus = z.infer<typeof organizationStatusSchema>;

export const organizationDtoSchema = z.object({
  id: z.string().uuid(),
  tenantKey: normalizedCodeSchema,
  displayName: z.string().min(1),
  legalMetadata: z.record(z.string(), z.unknown()).nullable(),
  status: organizationStatusSchema,
  statusReason: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  activatedAt: z.string().datetime({ offset: true }).nullable(),
  suspendedAt: z.string().datetime({ offset: true }).nullable(),
  recoveredAt: z.string().datetime({ offset: true }).nullable(),
  closedAt: z.string().datetime({ offset: true }).nullable(),
});
export type OrganizationDto = z.infer<typeof organizationDtoSchema>;

export const createOrganizationRequestSchema = z.object({
  tenantKey: codeInputSchema,
  displayName: z.string().min(1).max(200),
  legalMetadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

export const updateOrganizationDisplayMetadataRequestSchema = z.object({
  displayName: z.string().min(1).max(200).optional(),
  legalMetadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateOrganizationDisplayMetadataRequest = z.infer<
  typeof updateOrganizationDisplayMetadataRequestSchema
>;

export const suspendOrganizationRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type SuspendOrganizationRequest = z.infer<typeof suspendOrganizationRequestSchema>;

export const recoverOrganizationRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type RecoverOrganizationRequest = z.infer<typeof recoverOrganizationRequestSchema>;

export const closeOrganizationRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type CloseOrganizationRequest = z.infer<typeof closeOrganizationRequestSchema>;
