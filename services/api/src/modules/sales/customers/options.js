// Everything the customer screens need to draw their forms and filters.
import { canViewCustomerFinancials, customerCapabilities, requireCustomerPermission } from "./access.js";
import {
  CUSTOMER_ADDRESS_TYPES, CUSTOMER_CONTACT_ROLES, CUSTOMER_KINDS, CUSTOMER_PERMISSIONS, CUSTOMER_STATUSES, CUSTOMER_VIEWS, GST_REGISTRATION_TYPES, GST_STATES,
} from "./constants.js";
import { canOverrideCustomerDuplicate } from "./duplicates.js";

export const COUNTRIES = Object.freeze([
  ["IN", "India"], ["AE", "United Arab Emirates"], ["AU", "Australia"], ["BD", "Bangladesh"], ["BH", "Bahrain"], ["BT", "Bhutan"], ["CA", "Canada"], ["CH", "Switzerland"],
  ["CN", "China"], ["DE", "Germany"], ["EG", "Egypt"], ["ES", "Spain"], ["FR", "France"], ["GB", "United Kingdom"], ["HK", "Hong Kong"], ["ID", "Indonesia"], ["IE", "Ireland"],
  ["IT", "Italy"], ["JP", "Japan"], ["KE", "Kenya"], ["KR", "South Korea"], ["KW", "Kuwait"], ["LK", "Sri Lanka"], ["MU", "Mauritius"], ["MV", "Maldives"], ["MY", "Malaysia"],
  ["NG", "Nigeria"], ["NL", "Netherlands"], ["NP", "Nepal"], ["NZ", "New Zealand"], ["OM", "Oman"], ["PH", "Philippines"], ["QA", "Qatar"], ["SA", "Saudi Arabia"],
  ["SE", "Sweden"], ["SG", "Singapore"], ["TH", "Thailand"], ["TR", "Türkiye"], ["TZ", "Tanzania"], ["US", "United States"], ["VN", "Vietnam"], ["ZA", "South Africa"],
].map(([code, name]) => Object.freeze({ code, name })));

export async function getCustomerOptions(client, context) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.view, "You do not have permission to view customers.");
  const key = [context.organizationId];
  const rows = async (sql) => (await client.query(sql, key)).rows;
  const organization = (await rows(`SELECT base_currency, country_code FROM public.organizations WHERE id = $1`))[0] ?? {};
  const finance = canViewCustomerFinancials(context);
  return {
    kinds: CUSTOMER_KINDS,
    statuses: CUSTOMER_STATUSES,
    gstRegistrationTypes: GST_REGISTRATION_TYPES,
    gstStates: GST_STATES,
    addressTypes: CUSTOMER_ADDRESS_TYPES,
    contactRoles: CUSTOMER_CONTACT_ROLES,
    countries: COUNTRIES,
    views: CUSTOMER_VIEWS.filter((view) => !view.finance || finance).map(({ key: viewKey, label }) => ({ key: viewKey, label })),
    currencies: (await rows(`SELECT code, name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`)).map((row) => ({ code: row.code.trim(), name: row.name })),
    priceLists: (await rows(`SELECT id, name, currency_code FROM tenant.price_lists WHERE organization_id = $1 AND price_list_type = 'sales' AND status = 'active' ORDER BY name`))
      .map((row) => ({ id: row.id, name: row.name, currencyCode: row.currency_code?.trim() ?? null })),
    paymentTerms: (await rows(`SELECT id, name, default_due_days, calculation_type FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' AND is_sales_enabled
                                 ORDER BY (calculation_type = 'custom'), default_due_days, name`))
      .map((row) => ({ id: row.id, name: row.name, dueDays: row.default_due_days })),
    salespeople: (await rows(
      `SELECT users.id, users.full_name FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
        WHERE membership.organization_id = $1 AND membership.status = 'active' AND users.status = 'active' ORDER BY users.full_name`)).map((row) => ({ id: row.id, name: row.full_name })),
    defaults: { currencyCode: organization.base_currency?.trim() ?? null, countryCode: organization.country_code?.trim() ?? "IN", ownerUserId: context.userId ?? null },
    showsFinancials: finance,
    canOverrideDuplicate: canOverrideCustomerDuplicate(context),
    capabilities: customerCapabilities(context),
  };
}
