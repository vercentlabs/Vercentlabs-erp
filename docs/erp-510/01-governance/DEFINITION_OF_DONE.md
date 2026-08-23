# Mandatory Feature — Definition of Done

A mandatory feature can be marked COMPLETE only after all applicable checks
pass.

## Requirements

- [ ] Business requirements understood
- [ ] Existing implementation audited
- [ ] Gap documented

## Database

- [ ] Correct schema exists
- [ ] Constraints exist
- [ ] Indexes exist where required
- [ ] Organization isolation preserved
- [ ] Company scope preserved
- [ ] Branch scope preserved where applicable
- [ ] Migration is reproducible

## Domain Logic

- [ ] Business rules implemented
- [ ] Invalid transitions blocked
- [ ] Validation implemented
- [ ] Transactions used where required
- [ ] Idempotency handled where required
- [ ] No hardcoded fake calculations

## API

- [ ] API exists where required
- [ ] Inputs validated
- [ ] Errors are safe and predictable
- [ ] Authorization enforced server-side

## Access Control

- [ ] Module access enforced
- [ ] Role access enforced
- [ ] Permission enforced
- [ ] Company access enforced
- [ ] Branch access enforced where applicable
- [ ] Record-level access enforced where applicable
- [ ] Sensitive fields protected

## UI

- [ ] Feature is reachable from the ERP
- [ ] Create workflow exists where required
- [ ] Edit workflow exists where required
- [ ] Actions exist where required
- [ ] List/detail views exist where required
- [ ] Search/filter exists where required
- [ ] Loading state works
- [ ] Empty state works
- [ ] Error state works
- [ ] Responsive behavior works
- [ ] Accessibility checked

## Integration

- [ ] Upstream integrations tested
- [ ] Downstream integrations tested
- [ ] Accounting impact tested where applicable
- [ ] Stock impact tested where applicable
- [ ] Quality impact tested where applicable
- [ ] Audit events tested

## Tests

- [ ] Unit tests
- [ ] API tests
- [ ] Permission tests
- [ ] Tenant isolation tests
- [ ] Integration tests
- [ ] Regression tests
- [ ] Manual UAT

## Documentation

- [ ] Feature specification updated
- [ ] Feature register updated
- [ ] UAT evidence recorded

Only then:

STATUS = COMPLETE
UAT = READY
