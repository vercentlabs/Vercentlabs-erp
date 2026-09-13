import { integer, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const platformSchema = pgSchema('platform');

export const companies = platformSchema.table('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  companyCode: text('company_code').notNull(),
  legalName: text('legal_name').notNull(),
  displayName: text('display_name').notNull(),
  countryCode: text('country_code').notNull(),
  baseCurrency: text('base_currency').notNull(),
  timeZone: text('time_zone').notNull(),
  taxRegistrations: jsonb('tax_registrations').notNull().default([]),
  status: text('status').notNull().default('DRAFT'),
  statusReason: text('status_reason'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export type CompanyRow = typeof companies.$inferSelect;

export const operatingUnits = platformSchema.table('operating_units', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  companyId: uuid('company_id').notNull(),
  unitCode: text('unit_code').notNull(),
  name: text('name').notNull(),
  unitType: text('unit_type').notNull(),
  parentOperatingUnitId: uuid('parent_operating_unit_id'),
  status: text('status').notNull().default('DRAFT'),
  statusReason: text('status_reason'),
  timeZone: text('time_zone').notNull(),
  address: jsonb('address'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy: text('created_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export type OperatingUnitRow = typeof operatingUnits.$inferSelect;
