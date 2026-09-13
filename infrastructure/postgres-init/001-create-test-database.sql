-- Runs once, on first container initialization only (per the official
-- postgres image's /docker-entrypoint-initdb.d behavior). Creates a second,
-- clearly-named database for tests/integration and packages/database's
-- safe test-database helper, which refuses to operate on anything whose
-- name does not contain "test".
CREATE DATABASE vercentlabs_erp_test;
