# Vercentlabs ERP — Protected Core Foundation

These capabilities form the foundation of the ERP.

They are NOT optional module features.

They must not be deleted, bypassed, weakened or rebuilt separately inside
individual modules unless an architectural change is intentionally approved.

---

# 1. Tenant / Organization

Every business belongs to a tenant/organization.

Mandatory:

- organization identity
- tenant isolation
- organization settings
- organization status
- organization-level configuration
- organization-level module enablement
- organization-level billing/entitlement

No tenant may access another tenant's records.

---

# 2. Companies

An organization may contain one or more companies.

Mandatory:

- company master
- company status
- company configuration
- company-specific records
- company context
- company access restrictions
- multi-company support

Business records must maintain correct company ownership where applicable.

---

# 3. Branches

Companies may contain multiple branches/locations.

Mandatory:

- branch master
- company → branch relationship
- active branch context
- branch-specific access
- branch-level record filtering where required
- branch switching

---

# 4. Users

Mandatory:

- user accounts
- account status
- authentication
- session management
- invitation/onboarding
- password/security controls
- profile
- organization membership
- company access
- branch access

---

# 5. Teams and Departments

Mandatory:

- teams
- departments
- memberships
- managers
- reporting structure
- business ownership
- team-based assignment where applicable

---

# 6. Roles

Mandatory:

- role catalogue
- custom/managed role assignment
- module-aware roles
- organization membership roles
- role assignment
- role revocation

Roles provide permissions.

Roles do not replace server-side authorization.

---

# 7. Permissions

Permissions are one of the most important ERP foundations.

Mandatory:

- module permissions
- view permissions
- create permissions
- update permissions
- delete/cancel permissions
- approval permissions
- sensitive-field permissions
- administrative permissions
- reporting permissions

All sensitive operations must enforce permissions server-side.

UI hiding is never sufficient authorization.

---

# 8. Record-Level Access

Where required, users must only see records they are entitled to see.

Possible dimensions include:

- own records
- team records
- department records
- company records
- branch records
- assigned records
- all permitted records

Record-level security must be applied at data/API boundaries.

---

# 9. Module Access

Access to a module is determined through the complete access chain:

Product availability
↓
Organization module enablement
↓
Plan / entitlement
↓
Role
↓
Permission
↓
Record/company/branch scope

A sidebar link alone never grants access.

---

# 10. Authentication and Sessions

Mandatory:

- secure authentication
- secure sessions
- expiration
- login protection
- logout
- password reset
- invitation flow
- session invalidation
- security logging

---

# 11. Audit Trail

Important business actions must be attributable.

Audit data should answer:

- who
- did what
- to which record
- when
- from which organization/company context
- previous state where required
- new state where required

Financial and approval workflows require especially strong auditability.

---

# 12. Approval Framework

ERP modules should reuse a common approval concept where practical.

Examples:

- quotation approval
- purchase approval
- payroll approval
- stock adjustment approval
- journal approval
- asset disposal approval

Approval authorization must be enforced on the server.

---

# 13. Shared Context

The ERP shell must consistently understand:

- organization
- user
- membership
- company
- branch
- role
- permissions
- module entitlement

Modules must not invent incompatible authorization contexts.

---

# 14. Unified Navigation

Administrators may see all enabled modules in one sidebar.

Other users see a filtered workspace appropriate to their job.

Example:

Administrator:
all relevant modules

Salesperson:
CRM + Sales

Warehouse:
Stock + Quality

HR:
HR & Payroll

Support Agent:
Support + allowed CRM/customer context

The navigation tree must derive from authorization/module-access data.

---

# NON-NEGOTIABLE RULE

Feature development must preserve this core foundation.

A new feature is NOT allowed to bypass:

- organization isolation
- company scope
- branch scope
- roles
- permissions
- module entitlement
- record-level access
- audit requirements
