// Who may do what to a product. The catalogue is organisation-wide: anyone
// who may view products sees all of them. Cost (default purchase cost,
// standard and average inventory cost) is visible only with View Cost.
import { PRODUCT_PERMISSIONS, ProductError } from "./constants.js";

export function productCan(context, permission) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes(permission));
}

export function requireProductPermission(context, permission, message = "You do not have permission to do this.") {
  if (!productCan(context, permission)) throw new ProductError(403, message, "PERMISSION_DENIED");
}

export const canViewProductCost = (context) => productCan(context, PRODUCT_PERMISSIONS.viewCost);

export function productCapabilities(context) {
  return Object.fromEntries(Object.entries(PRODUCT_PERMISSIONS).map(([name, permission]) => [name, productCan(context, permission)]));
}
