// Who may do what with price lists. Price lists are organisation-wide.
import { PRICE_LIST_PERMISSIONS, PriceListError } from "./constants.js";

export function priceListCan(context, permission) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes(permission));
}

export function requirePriceListPermission(context, permission, message = "You do not have permission to do this.") {
  if (!priceListCan(context, permission)) throw new PriceListError(403, message, "PERMISSION_DENIED");
}

export function priceListCapabilities(context) {
  return Object.fromEntries(Object.entries(PRICE_LIST_PERMISSIONS).map(([name, permission]) => [name, priceListCan(context, permission)]));
}
