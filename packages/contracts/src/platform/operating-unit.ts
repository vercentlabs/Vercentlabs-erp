import { z } from 'zod';
import { normalizedCodeSchema, codeInputSchema } from './codes.js';
import { iso3166Alpha2CountryCodeSchema, ianaTimeZoneNameSchema } from './iso-codes.js';

export const operatingUnitStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED']);
export type OperatingUnitStatus = z.infer<typeof operatingUnitStatusSchema>;

/**
 * BRANCH, SITE and OPERATING_UNIT are the only recognized kinds this
 * capability represents. Warehouse, plant, project and store are
 * module-specific concepts owned by future business modules; they must
 * reference an operating unit, never duplicate this table.
 */
export const operatingUnitTypeSchema = z.enum(['BRANCH', 'SITE', 'OPERATING_UNIT']);
export type OperatingUnitType = z.infer<typeof operatingUnitTypeSchema>;

export const addressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(30).optional(),
  countryCode: iso3166Alpha2CountryCodeSchema,
});
export type Address = z.infer<typeof addressSchema>;

export const operatingUnitDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  companyId: z.string().uuid(),
  unitCode: normalizedCodeSchema,
  name: z.string().min(1),
  unitType: operatingUnitTypeSchema,
  parentOperatingUnitId: z.string().uuid().nullable(),
  status: operatingUnitStatusSchema,
  statusReason: z.string().nullable(),
  timeZone: z.string().min(1),
  address: addressSchema.nullable(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type OperatingUnitDto = z.infer<typeof operatingUnitDtoSchema>;

export const createOperatingUnitRequestSchema = z.object({
  unitCode: codeInputSchema,
  name: z.string().min(1).max(200),
  unitType: operatingUnitTypeSchema,
  parentOperatingUnitId: z.string().uuid().optional(),
  timeZone: ianaTimeZoneNameSchema,
  address: addressSchema.optional(),
});
export type CreateOperatingUnitRequest = z.infer<typeof createOperatingUnitRequestSchema>;

export const updateOperatingUnitRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  timeZone: ianaTimeZoneNameSchema.optional(),
  address: addressSchema.optional(),
});
export type UpdateOperatingUnitRequest = z.infer<typeof updateOperatingUnitRequestSchema>;

export const operatingUnitLifecycleReasonRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type OperatingUnitLifecycleReasonRequest = z.infer<
  typeof operatingUnitLifecycleReasonRequestSchema
>;
