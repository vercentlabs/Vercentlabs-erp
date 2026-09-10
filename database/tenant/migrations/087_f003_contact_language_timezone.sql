BEGIN;

-- CRM vNext Prompt 3 (CRM-VNEXT-036): F003 dossier gap — Contacts had no
-- preferred-language/timezone fields, blocking correctly-scheduled future
-- communication (F016/F018) and locale-correct display. Canonical IANA
-- timezone identifiers only (never an ambiguous offset/locale string) and
-- a BCP-47 language tag; both nullable (most existing contacts have
-- neither recorded yet, and neither is a required field).
ALTER TABLE tenant.contacts
  ADD COLUMN IF NOT EXISTS preferred_language text,
  ADD COLUMN IF NOT EXISTS timezone text;

COMMIT;
