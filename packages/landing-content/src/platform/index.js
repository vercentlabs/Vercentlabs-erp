/**
 * Product and platform pages: /product and the six pages under it (plus
 * /security). Each file owns one page's content; route slugs live in each
 * page's `slug` field.
 */
import { AUTOMATION_PAGE } from "./controls.js";
import { INTEGRATIONS_PAGE } from "./import-export.js";
import { PLATFORM_PAGE } from "./platform.js";
import { ANALYTICS_PAGE } from "./reporting.js";
import { MOBILE_PAGE } from "./responsive-access.js";
import { SECURITY_PAGE } from "./security.js";

export { PRODUCT_OVERVIEW_PAGE } from "./product-overview.js";
export { AUTOMATION_PAGE, INTEGRATIONS_PAGE, PLATFORM_PAGE, ANALYTICS_PAGE, MOBILE_PAGE, SECURITY_PAGE };

/** The six platform pages in navigation order. */
export const PLATFORM_PAGES = Object.freeze([PLATFORM_PAGE, AUTOMATION_PAGE, ANALYTICS_PAGE, MOBILE_PAGE, INTEGRATIONS_PAGE, SECURITY_PAGE]);
