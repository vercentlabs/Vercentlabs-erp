# Assets Reference Architecture

## Ownership
Assets owns asset identity/category, operational state, custody/location/movement history, maintenance/inspection/calibration/verification evidence and disposal workflow snapshot. Accounting owns journal/GL/period truth; Procurement owns PO/GRN/vendor-invoice truth; Stock owns parts/stock movements; HR owns employees; Manufacturing owns production schedules/capacity.

## Write path
Authentication → organization/module entitlement → permission → company/branch/site/record scope → validation → lifecycle/effective-date/SoD guard → transaction/concurrency guard → asset event/audit → outbox/public integration intent → response. Financial downstream effects are idempotent and reconciled.

## Financial model
Asset category/book policy defines accounts, useful-life/depreciation defaults, convention/rounding and reporting purpose. Asset/book schedule lines progress planned/ready/posted/reversed. Carrying value is reconstructed from authoritative capitalized/value-adjustment/depreciation/disposal history, not an AI estimate or silently mutable field.

## Field model
Barcode/QR scan resolves stable asset identity. Mobile field actions reauthorize on the server and capture evidence; offline drafts/queues never bypass state, custody, maintenance, calibration or financial rules.
