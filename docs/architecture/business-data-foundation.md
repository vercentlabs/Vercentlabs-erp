# Business Data Foundation

The Business Data Foundation is the governed master-data layer shared by CRM,
Sales, Procurement, Inventory, Accounting, Manufacturing and later ERP modules.

## Permanent boundaries

- `database/tenant/migrations` owns ERP business records.
- `services/api` owns reusable business-domain queries and mutations.
- `packages/shared-types` owns framework-free resource contracts.
- `packages/shared-sdk` owns typed client helpers.
- `packages/database` owns tenant-context database helpers.
- `packages/permissions` owns framework-neutral permission keys.
- `apps/web` owns authenticated pages, thin Route Handlers and presentation.
- Existing platform activities, comments, attachments, custom fields,
  approvals, numbering and audit records remain shared; they are not duplicated.

## Included master records

- Customers, suppliers, prospects and dual-role business partners
- Contacts and registered, billing, shipping, office and plant addresses
- Items, services, item groups and units of measure
- Warehouses and hierarchical warehouse locations
- GST-oriented tax categories and effective-dated tax rates
- Payment terms, price lists, currencies and exchange rates
- Company fiscal periods
- External identifiers and governed import jobs

## Isolation model

Every tenant table contains `organization_id`. API work runs in a transaction
that sets `app.current_organization_id` locally. PostgreSQL Row Level Security
then checks the transaction context for every tenant-table operation.

The service layer also applies explicit organisation and company/branch
predicates. This defence-in-depth model avoids relying on UI filtering.

Production database connections must use a non-superuser, non-BYPASSRLS role.
Migration ownership and application runtime access should be separated before
production deployment.

## Access model

- `business_data.view` — read shared master data
- `parties.manage` — maintain partners, contacts and addresses
- `items.manage` — maintain items, groups and units
- `inventory_setup.manage` — maintain warehouses and locations
- `finance_setup.manage` — maintain tax, currency, terms, prices and periods
- `business_data.import` — run governed batch imports

The organisation owner and system administrator retain complete access.
Company and functional manager roles receive only the relevant capabilities.

## API model

Authenticated web routes live at:

```text
/api/business-data/[resource]
/api/business-data/[resource]/[id]
/api/business-data/[resource]/export
/api/business-data/[resource]/import
```

Route Handlers authenticate, authorize, validate and audit. Reusable SQL and
scope enforcement stay in `@vercent/api`.

## Next module dependency

CRM may now use `business_parties`, `contacts` and `addresses` for lead
conversion. Sales and Procurement may reuse parties, items, taxes, terms and
price lists. Inventory may reuse items, warehouses and locations.
