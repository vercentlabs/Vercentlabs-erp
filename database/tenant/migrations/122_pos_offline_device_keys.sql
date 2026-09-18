BEGIN;

-- F297 (offline POS workspace): "local data must be encrypted at rest on
-- the device" needs a real key-derivation mechanism, not a checkbox. The
-- browser has no secure enclave, so the actual AES-GCM key used to encrypt
-- the IndexedDB offline queue/snapshot is derived client-side (via
-- Web Crypto PBKDF2) from two ingredients: (1) this per-user server-issued
-- random seed, delivered only inside the authenticated HTTPS offline
-- snapshot response (services/api/src/modules/point-of-sale/features/
-- offline-sync.js), and (2) a random per-browser-profile salt generated
-- once client-side via crypto.getRandomValues() and stored unencrypted in
-- IndexedDB (a salt is not a secret). Neither half alone is enough to
-- derive the key, so a stolen device-profile backup without ever having
-- authenticated is not decryptable, and a leaked seed without the device's
-- own profile is not decryptable either. This is deliberately NOT a
-- defense against malicious code running in the same browser origin at
-- runtime (it can call the same Web Crypto APIs) or a compromised device
-- the user is already logged into — see the offline-sync.js header comment
-- and the final task report for the full threat-model writeup.
CREATE TABLE IF NOT EXISTS tenant.pos_offline_device_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  key_material text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,company_id,user_id)
);

ALTER TABLE tenant.pos_offline_device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.pos_offline_device_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pos_offline_device_keys_organization_isolation ON tenant.pos_offline_device_keys;
CREATE POLICY pos_offline_device_keys_organization_isolation ON tenant.pos_offline_device_keys
  USING (organization_id=tenant.current_organization_id())
  WITH CHECK (organization_id=tenant.current_organization_id());

COMMIT;
