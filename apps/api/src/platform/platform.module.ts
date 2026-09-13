import { Module } from '@nestjs/common';
import { PlatformAuthModule } from './auth/platform-auth.module.js';
import { PlatformDatabaseModule } from './database/platform-database.module.js';
import { OrganizationsController } from './organizations/organizations.controller.js';
import { CompaniesController } from './companies/companies.controller.js';
import { OperatingUnitsController } from './operating-units/operating-units.controller.js';

/**
 * SP001-SP003 shared-platform HTTP surface (organizations, companies,
 * operating units). Explicitly does not implement SP004-SP010
 * (authentication/authorization) - see PlatformAuthModule for the
 * fail-closed boundary standing in for that until it exists.
 */
@Module({
  imports: [PlatformAuthModule, PlatformDatabaseModule],
  controllers: [OrganizationsController, CompaniesController, OperatingUnitsController],
})
export class PlatformModule {}
