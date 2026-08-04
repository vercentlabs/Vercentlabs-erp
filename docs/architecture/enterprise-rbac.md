# Enterprise roles and permissions

## Release boundary

This access model covers the currently released Platform, CRM, Sales, Accounting and Procurement capabilities. Stock, Manufacturing and HR & Payroll role templates remain visible to administrators as future templates but cannot be assigned until their modules are enabled.

## Effective access

A user may hold several active roles. Permissions are cumulative. One role is marked primary for display, legacy membership context and controlled ownership transfer. An assignment is effective only when its status is active, its start time has arrived and its optional expiry has not passed.

Access is the intersection of:

1. the union of permissions from effective roles;
2. organisation membership status;
3. company and branch scope;
4. optional department and team associations;
5. tenant isolation and row-level security in the business modules.

Organisation Owners and System Administrators may operate across all companies and branches. Company Administrators and delegated access administrators cannot grant scopes outside their own company, branch, department or team assignments.

## Role templates

The templates deliberately separate preparation, execution and approval duties. Examples include Accountant versus Finance Manager, Accounts Payable Executive versus Treasury Executive, Buyer versus Purchase Approver, and Sales Representative versus Sales Manager. Employee is a platform-only baseline and receives business access only through additional roles.

System templates are immutable. Administrators clone them into custom roles, where every update creates an immutable version snapshot and revokes affected sessions.

## Privilege controls

- Administrators cannot grant permissions they do not hold.
- Non-global administrators cannot grant organisational scopes they do not hold.
- Organisation ownership uses a dedicated transfer flow.
- Blocking segregation-of-duties conflicts cannot be saved.
- Warning conflicts require explicit acknowledgement and `access.sod.override`.
- Access changes, invitation acceptance and role versions write immutable evidence.
- Role, scope and membership changes revoke sessions so subsequent access is rebuilt from current data.

## Current limits

Department and team assignments are organisational scope metadata. Individual business services continue to enforce their existing company, branch, owner and tenant rules. Generic amount-based approval matrices and delegated approval chains are not introduced by this migration; they remain domain-specific controls.
