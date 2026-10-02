import { ERP_MODULE_CATALOG, getErpModule } from "@vercentlabs/shared-types";
import { ACCOUNTING_MODULE } from "./accounting.js";
import { ASSETS_MODULE } from "./assets.js";
import { CRM_MODULE } from "./crm.js";
import { HR_PAYROLL_MODULE } from "./hr-payroll.js";
import { MANUFACTURING_MODULE } from "./manufacturing.js";
import { POINT_OF_SALE_MODULE } from "./point-of-sale.js";
import { PROCUREMENT_MODULE } from "./procurement.js";
import { PROJECTS_MODULE } from "./projects.js";
import { QUALITY_MODULE } from "./quality.js";
import { SALES_MODULE } from "./sales.js";
import { STOCK_MODULE } from "./stock.js";
import { SUPPORT_MODULE } from "./support.js";

export { MODULES_INDEX_PAGE, MODULE_DETAIL_PAGE } from "./modules-page.js";

/**
 * The 12 business modules. Each file in this folder holds one module's
 * marketing content; the ERP module catalog (@vercentlabs/shared-types) owns
 * module identity (`key`, `name`, `description`) and order. Catalog fields are
 * spread last, so the catalog always wins if the two disagree.
 */
const MODULE_CONTENT = new Map(
  [
    CRM_MODULE,
    SALES_MODULE,
    PROCUREMENT_MODULE,
    STOCK_MODULE,
    MANUFACTURING_MODULE,
    PROJECTS_MODULE,
    ASSETS_MODULE,
    POINT_OF_SALE_MODULE,
    QUALITY_MODULE,
    SUPPORT_MODULE,
    HR_PAYROLL_MODULE,
    ACCOUNTING_MODULE,
  ].map((content) => [content.key, content]),
);

function withCatalogIdentity(erpModule) {
  return Object.freeze({ ...MODULE_CONTENT.get(erpModule.key), ...erpModule });
}

/** The 12 marketing-enriched modules, in ERP_MODULE_CATALOG order. */
export const LANDING_MODULES = Object.freeze(ERP_MODULE_CATALOG.map(withCatalogIdentity));

export function getLandingModule(key) {
  const erpModule = getErpModule(key);
  if (!erpModule) return null;
  return withCatalogIdentity(erpModule);
}

export function getModulesByNavGroup(navGroup) {
  return LANDING_MODULES.filter((module) => module.navGroup === navGroup);
}
