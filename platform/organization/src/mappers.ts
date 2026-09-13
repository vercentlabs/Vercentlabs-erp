import type {
  Address,
  CompanyDto,
  CompanyStatus,
  OperatingUnitDto,
  OperatingUnitStatus,
  OperatingUnitType,
  TaxRegistration,
} from '@vercentlabs/contracts';
import type { CompanyRow, OperatingUnitRow } from './schema.js';

export function toCompanyDto(row: CompanyRow): CompanyDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    companyCode: row.companyCode,
    legalName: row.legalName,
    displayName: row.displayName,
    countryCode: row.countryCode,
    baseCurrency: row.baseCurrency,
    timeZone: row.timeZone,
    taxRegistrations: (row.taxRegistrations as TaxRegistration[] | null) ?? [],
    status: row.status as CompanyStatus,
    statusReason: row.statusReason,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toOperatingUnitDto(row: OperatingUnitRow): OperatingUnitDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    companyId: row.companyId,
    unitCode: row.unitCode,
    name: row.name,
    unitType: row.unitType as OperatingUnitType,
    parentOperatingUnitId: row.parentOperatingUnitId,
    status: row.status as OperatingUnitStatus,
    statusReason: row.statusReason,
    timeZone: row.timeZone,
    address: (row.address as Address | null) ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
