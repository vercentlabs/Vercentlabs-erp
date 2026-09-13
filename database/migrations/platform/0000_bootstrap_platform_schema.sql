-- Bootstrap migration for the platform schema boundary.
-- This creates only the schema itself. No platform tables are created here:
-- SP001-SP036 remain NOT_STARTED per product/registers/shared-platform.yaml,
-- and this prompt is scoped to engineering foundation only.
CREATE SCHEMA IF NOT EXISTS platform;
