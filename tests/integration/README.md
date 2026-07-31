# Integration tests

Cross-package contract tests remain in this directory. Infrastructure-backed
verification must execute against real services and must not silently pass when
its dependency is absent.

Stage 1 provides `pnpm test:platform-live`, which requires migrated PostgreSQL,
a restricted runtime database role and Chromium. CI runs it after migrations
and all database verifiers.
