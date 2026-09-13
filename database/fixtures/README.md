# Database fixtures

Reserved for deterministic fixture data loaded by integration tests
(`tests/integration`) once shared-platform capabilities have real tables to
populate. No fixtures exist yet; `packages/database`'s test-database helper
(`@vercentlabs/database/testing`) currently only bootstraps the empty
`platform` and `tenant` schemas.
