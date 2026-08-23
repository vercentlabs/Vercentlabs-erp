# ERP 510 Program Rules

## Rule 1

One mandatory feature is implemented completely before being declared complete.

## Rule 2

Do not fabricate completeness.

The following are NOT automatically complete features:

- a database table
- a migration
- an API endpoint
- a backend function
- a read-only UI
- a form without working backend
- mock integration
- manually entered external reference
- placeholder button
- unused configuration
- hardcoded calculation

## Rule 3

Reuse the ERP core.

Features must use the existing organization, company, branch, role,
permission and module-access architecture.

## Rule 4

Server-side authorization is mandatory.

## Rule 5

Cross-module effects are part of the feature.

Example:

A Purchase Receipt cannot be considered complete if it should increase
inventory but does not update Stock.

## Rule 6

Financial calculations must be deterministic and tested.

## Rule 7

Every feature requires evidence.

Evidence may include:

- source implementation
- migration/schema
- API
- UI
- permissions
- automated tests
- integration tests
- manual UAT
