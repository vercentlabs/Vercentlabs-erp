BEGIN;

-- F270/F271 gap closure (disclosed since Session 3, re-confirmed in
-- POS_FINAL_FUNCTIONAL_VERIFICATION.md): tenant.pos_store_access (migration
-- 115) only ever scoped a cashier to a STORE, never to a specific terminal
-- within it. A store with five terminals had no way to restrict a cashier
-- to just one or two of them.
--
-- terminal_id is nullable and additive, never a breaking change to any
-- existing row: every row created before this migration has terminal_id
-- NULL, which keeps meaning exactly what it always meant -- "this user may
-- operate ANY terminal at this store" (a store-wide grant). A NEW row with
-- a real terminal_id is a narrower, terminal-specific grant. A user can
-- hold at most one store-wide grant per store (partial unique index
-- below) and any number of terminal-specific grants; assertPosStoreAccess
-- (shared/access-control.js) checks store-wide first, falling back to an
-- exact terminal match only when the caller passes a terminalId at all --
-- every existing call site that never passes one is completely unaffected.
ALTER TABLE tenant.pos_store_access
  ADD COLUMN IF NOT EXISTS terminal_id uuid REFERENCES tenant.pos_terminals(id) ON DELETE CASCADE;

ALTER TABLE tenant.pos_store_access
  DROP CONSTRAINT IF EXISTS pos_store_access_organization_id_user_id_store_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS pos_store_access_storewide_uidx
  ON tenant.pos_store_access(organization_id,user_id,store_id)
  WHERE terminal_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS pos_store_access_terminal_uidx
  ON tenant.pos_store_access(organization_id,user_id,store_id,terminal_id)
  WHERE terminal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS pos_store_access_terminal_idx
  ON tenant.pos_store_access(organization_id,terminal_id) WHERE terminal_id IS NOT NULL;

COMMIT;
