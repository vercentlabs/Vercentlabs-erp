import { z } from 'zod';
import { normalizedCodeSchema, codeInputSchema } from './codes.js';
import {
  iso4217CurrencyCodeSchema,
  iso3166Alpha2CountryCodeSchema,
  ianaTimeZoneNameSchema,
} from './iso-codes.js';

export const companyStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'CLOSED']);
export type CompanyStatus = z.infer<typeof companyStatusSchema>;

export const taxRegistrationSchema = z.object({
  kind: z.string().min(1).max(50),
  value: z.string().min(1).max(100),
});
export type TaxRegistration = z.infer<typeof taxRegistrationSchema>;

export const companyDtoSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  companyCode: normalizedCodeSchema,
  legalName: z.string().min(1),
  displayName: z.string().min(1),
  countryCode: z.string().length(2),
  baseCurrency: z.string().length(3),
  timeZone: z.string().min(1),
  taxRegistrations: z.array(taxRegistrationSchema),
  status: companyStatusSchema,
  statusReason: z.string().nullable(),
  version: z.number().int().min(1),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type CompanyDto = z.infer<typeof companyDtoSchema>;

export const createCompanyRequestSchema = z.object({
  companyCode: codeInputSchema,
  legalName: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  countryCode: iso3166Alpha2CountryCodeSchema,
  baseCurrency: iso4217CurrencyCodeSchema,
  timeZone: ianaTimeZoneNameSchema,
  taxRegistrations: z.array(taxRegistrationSchema).max(20).optional(),
});
export type CreateCompanyRequest = z.infer<typeof createCompanyRequestSchema>;

export const updateCompanyRequestSchema = z.object({
  legalName: z.string().min(1).max(200).optional(),
  displayName: z.string().min(1).max(200).optional(),
  timeZone: ianaTimeZoneNameSchema.optional(),
  taxRegistrations: z.array(taxRegistrationSchema).max(20).optional(),
});
export type UpdateCompanyRequest = z.infer<typeof updateCompanyRequestSchema>;

export const companyLifecycleReasonRequestSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type CompanyLifecycleReasonRequest = z.infer<typeof companyLifecycleReasonRequestSchema>;
