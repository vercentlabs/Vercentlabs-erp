# Vercentlabs ERP — Launch Gate

The ERP is launch-ready only when the agreed mandatory scope meets the required
quality threshold.

## Core Foundation

- [ ] Tenant isolation verified
- [ ] Company access verified
- [ ] Branch access verified
- [ ] Users verified
- [ ] Teams/departments verified
- [ ] Roles verified
- [ ] Permissions verified
- [ ] Record-level access verified
- [ ] Module entitlement verified
- [ ] Authentication verified
- [ ] Audit trail verified
- [ ] Role-based navigation verified

## Mandatory Features

- [ ] Required mandatory feature scope COMPLETE
- [ ] No P0 mandatory feature NOT_READY
- [ ] No financially incorrect calculation path
- [ ] No mandatory workflow accessible only through direct API calls
- [ ] No production-critical mock integration presented as real

## Cross-Module

- [ ] CRM → Sales
- [ ] Sales → Stock → Accounting
- [ ] Procurement → Stock → Accounting
- [ ] Manufacturing → Stock
- [ ] Manufacturing → Quality → Stock
- [ ] POS → Stock → Accounting
- [ ] Payroll → Accounting
- [ ] Assets → Accounting
- [ ] Projects → Billing/Accounting
- [ ] Support → Customer 360

## Verification

- [ ] Typecheck passes
- [ ] Lint passes
- [ ] Unit tests pass
- [ ] API tests pass
- [ ] Integration tests pass
- [ ] Security tests pass
- [ ] Permission tests pass
- [ ] Database verification passes
- [ ] Production build passes
- [ ] UAT passes
