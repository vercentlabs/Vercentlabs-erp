-- The built-in Read-only User's description still spoke of "assigned companies and branches", which the product does not have
-- (one company per workspace). Same wording as packages/permissions roles.js.
UPDATE public.roles
   SET description = 'Read-only access to the released business modules and their reports. Cannot create, change or delete anything.', updated_at = now()
 WHERE slug = 'read_only' AND is_system AND description LIKE '%companies and branches%';

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0195_read_only_role_wording.sql', 'read-only-role-wording') ON CONFLICT DO NOTHING;
