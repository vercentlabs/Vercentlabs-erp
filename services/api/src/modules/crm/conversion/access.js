// Who may convert, and what they may do while converting.
//
// Conversion is one governed operation. Its own permissions decide whether
// the caller may create or link an account and contact, reassign, or
// override a duplicate. The account, contact and opportunity operations it
// calls check their own module permissions, so after this module has checked
// the caller's conversion rights, record visibility and owner rules with the
// caller's real context, it calls them with `operationContext`, which carries
// only the extra rights the conversion granted.
import { CrmError } from "../data-management/errors.js";
import { CONVERSION_PERMISSIONS } from "./constants.js";

const isOwner = (context) => Boolean(context.roleSlugs?.includes("organization_owner"));
const holds = (context, permission) => Boolean(context.permissions?.includes(permission));

export function conversionCan(context, permission) {
  return isOwner(context) || holds(context, permission);
}

export function requireConversionPermission(context, permission, message) {
  if (!conversionCan(context, permission)) throw new CrmError(403, message, "PERMISSION_DENIED");
}

export function conversionCapabilities(context) {
  return {
    convert: conversionCan(context, CONVERSION_PERMISSIONS.convert),
    overrideQualification: conversionCan(context, CONVERSION_PERMISSIONS.overrideQualification),
    useExisting: conversionCan(context, CONVERSION_PERMISSIONS.useExisting),
    createAccount: conversionCan(context, CONVERSION_PERMISSIONS.createAccount),
    createContact: conversionCan(context, CONVERSION_PERMISSIONS.createContact),
    changeOwner: conversionCan(context, CONVERSION_PERMISSIONS.changeOwner),
    overrideDuplicate: conversionCan(context, CONVERSION_PERMISSIONS.overrideDuplicate),
  };
}

// The caller's context plus the module rights this conversion has granted.
// `crm.records.view_all` lets the module operations accept the owners and
// records this module has already checked against the caller's own access.
export function operationContext(context, { overrideDuplicate = false } = {}) {
  const extra = [
    "crm.accounts.create", "crm.accounts.assign", "crm.contacts.create", "crm.contacts.edit", "crm.contacts.assign",
    "crm.opportunities.create", "crm.opportunities.assign", "crm.records.view_all",
    ...(overrideDuplicate ? ["crm.duplicates.override"] : []),
  ];
  return { ...context, permissions: [...new Set([...(context.permissions ?? []), ...extra])] };
}
