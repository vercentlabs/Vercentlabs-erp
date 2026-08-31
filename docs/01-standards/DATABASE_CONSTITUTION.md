# Database Constitution

Status: `APPROVED_FOR_ARCHITECTURE_FREEZE`

## Tenant data
Every tenant-owned table declares organization ownership, primary key, lifecycle timestamps, actor provenance where required, foreign keys, uniqueness/check constraints, indexes, RLS policy, deletion/archive policy, data classification and concurrency strategy. Company/branch/site/warehouse/project scope is explicit when the business record belongs to that dimension.

## Money
Authoritative money uses PostgreSQL `NUMERIC`/decimal-safe application representations. JavaScript binary floating-point is not authoritative for ledger, tax, payroll, valuation or settlement truth. API/JSON serialization must preserve exact decimal values. BigInt/NUMERIC values are normalized explicitly before JSON serialization; accidental `JSON.stringify(BigInt)` paths are prohibited.

## Quantities and UOM
Store authoritative quantity with UOM semantics, base quantity where needed, conversion version/effective date, precision and rounding rule. Inventory movement/valuation logic must not infer precision from display formatting.

## Time and effective dating
Distinguish business date, posting date, due date, effective-from/effective-to and timestamp-with-timezone. Statutory/tax/payroll/pricing/policy rules are effective-dated. Timezone/DST rules are explicit for attendance, SLA, shifts, scheduling and cutoffs.

## Posted truth
Ledgers and other irreversible business histories are append/correct/reverse oriented. Never rewrite history solely to make a current total look correct.

## Migrations
Every migration is deterministic, forward-safe and accompanied by structure/constraint/RLS verification. Destructive changes require expand-migrate-contract or an approved equivalent plus rollback/restore strategy.
