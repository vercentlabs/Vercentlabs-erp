-- CRM Notes and Attachments: what the team knows about a lead, account,
-- contact or opportunity, and the files that go with it.
--
--   1. Notes — an optional title, formatted text (sanitized HTML) beside a
--      plain-text copy for search and the timeline
--   2. Attachment details — description, display name and the note a file
--      belongs to, beside the shared file record; a retry key per upload
--   3. Content history — append-only: note created, edited, pinned,
--      deleted; file uploaded, renamed, deleted
--   4. Row-level security and grants
--   5. Permissions
--
-- Files stay in the Shared Platform file service (public.attachments for
-- metadata, object storage for the bytes); nothing here stores file content.
-- Notes and files belong to one record; a converted lead keeps its own.
--
-- Run once, after 0016_crm_follow_ups.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. notes

ALTER TABLE tenant.crm_notes
  ADD COLUMN title text,
  -- 'html': body is sanitized HTML from the editor; 'text': a plain note written before formatting existed
  ADD COLUMN body_format text DEFAULT 'text' NOT NULL,
  -- the note as plain text, for search and the timeline
  ADD COLUMN body_text text,
  ADD CONSTRAINT crm_notes_title_check CHECK (title IS NULL OR char_length(title) <= 200),
  ADD CONSTRAINT crm_notes_body_format_check CHECK (body_format = ANY (ARRAY['text', 'html']));

UPDATE tenant.crm_notes SET body_text = body WHERE body_text IS NULL;

CREATE INDEX crm_notes_record_idx ON tenant.crm_notes (organization_id, entity_type, entity_id, is_pinned DESC, created_at DESC) WHERE archived_at IS NULL;

-- ============================================================ 2. attachment details

CREATE TABLE tenant.crm_attachment_details (
  attachment_id uuid PRIMARY KEY REFERENCES public.attachments(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- the record the file belongs to (the note's record, for a note's file)
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  note_id uuid REFERENCES tenant.crm_notes(id) ON DELETE SET NULL,
  display_name text,
  description text,
  -- a retried upload with the same key returns the first one
  idempotency_key text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_attachment_details_entity_type_check CHECK (entity_type = ANY (ARRAY['lead', 'party', 'contact', 'opportunity', 'campaign'])),
  CONSTRAINT crm_attachment_details_display_name_check CHECK (display_name IS NULL OR char_length(display_name) <= 180),
  CONSTRAINT crm_attachment_details_description_check CHECK (description IS NULL OR char_length(description) <= 500)
);
CREATE INDEX crm_attachment_details_record_idx ON tenant.crm_attachment_details (organization_id, entity_type, entity_id);
CREATE INDEX crm_attachment_details_note_idx ON tenant.crm_attachment_details (organization_id, note_id) WHERE note_id IS NOT NULL;
CREATE UNIQUE INDEX crm_attachment_details_idempotency_uidx ON tenant.crm_attachment_details (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Files already attached to CRM records get a details row.
INSERT INTO tenant.crm_attachment_details (attachment_id, organization_id, entity_type, entity_id, created_at)
SELECT file.id, file.organization_id, substr(file.entity_type, 5), file.entity_id::uuid, file.created_at
  FROM public.attachments file
 WHERE file.entity_type = ANY (ARRAY['crm.lead', 'crm.party', 'crm.contact', 'crm.opportunity', 'crm.campaign'])
   AND file.entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT (attachment_id) DO NOTHING;

-- ============================================================ 3. content history

CREATE TABLE tenant.crm_content_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  -- what changed: a note or a file
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  event_type text NOT NULL,
  summary text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  CONSTRAINT crm_content_history_subject_type_check CHECK (subject_type = ANY (ARRAY['note', 'attachment'])),
  CONSTRAINT crm_content_history_event_type_check CHECK (event_type = ANY (ARRAY[
    'note_created', 'note_edited', 'note_pinned', 'note_unpinned', 'note_deleted', 'attachment_uploaded', 'attachment_renamed', 'attachment_deleted']))
);
CREATE INDEX crm_content_history_record_idx ON tenant.crm_content_history (organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX crm_content_history_subject_idx ON tenant.crm_content_history (organization_id, subject_id, created_at DESC);

-- ============================================================ 4. row-level security and grants

ALTER TABLE tenant.crm_attachment_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_attachment_details FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_attachment_details USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());
ALTER TABLE tenant.crm_content_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_content_history FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_isolation ON tenant.crm_content_history USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id());

GRANT SELECT, INSERT, UPDATE ON TABLE tenant.crm_attachment_details TO vercent_app;
GRANT SELECT ON TABLE tenant.crm_attachment_details TO vercent_worker;
-- Read and added to, never changed.
GRANT SELECT, INSERT ON TABLE tenant.crm_content_history TO vercent_app, vercent_worker;

-- ============================================================ 5. permissions

INSERT INTO public.permissions (key, name, category, description) VALUES
  ('crm.notes.view', 'View notes', 'CRM', 'Read the notes on records you can see.'),
  ('crm.notes.create', 'Create notes', 'CRM', 'Add a note to a lead, account, contact or opportunity.'),
  ('crm.notes.edit_own', 'Edit own notes', 'CRM', 'Change the notes you wrote.'),
  ('crm.notes.edit_all', 'Edit all notes', 'CRM', 'Change anyone''s notes.'),
  ('crm.notes.delete_own', 'Delete own notes', 'CRM', 'Delete the notes you wrote.'),
  ('crm.notes.delete_all', 'Delete all notes', 'CRM', 'Delete anyone''s notes.'),
  ('crm.notes.pin', 'Pin notes', 'CRM', 'Pin an important note to the top of a record.'),
  ('crm.attachments.view', 'View attachments', 'CRM', 'See the files on records you can see.'),
  ('crm.attachments.upload', 'Upload attachments', 'CRM', 'Add files to a lead, account, contact, opportunity or note.'),
  ('crm.attachments.download', 'Download attachments', 'CRM', 'Open and download the files on records you can see.'),
  ('crm.attachments.delete', 'Delete attachments', 'CRM', 'Delete anyone''s files. Everyone can delete the files they uploaded.')
ON CONFLICT (key) DO NOTHING;

-- Whoever can read CRM can read notes and files.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['crm.notes.view', 'crm.attachments.view', 'crm.attachments.download'])
 WHERE existing.permission_key = 'crm.view'
ON CONFLICT DO NOTHING;

-- Whoever could log CRM work writes notes and files.
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, permission.key
  FROM public.role_permissions existing
  JOIN public.permissions permission ON permission.key = ANY (ARRAY[
    'crm.notes.view', 'crm.notes.create', 'crm.notes.edit_own', 'crm.notes.delete_own', 'crm.notes.pin',
    'crm.attachments.view', 'crm.attachments.upload', 'crm.attachments.download'])
 WHERE existing.permission_key = ANY (ARRAY['crm.activities.manage', 'crm.leads.edit', 'crm.opportunities.manage', 'crm.accounts.edit', 'crm.contacts.edit'])
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, permission.key
  FROM public.roles role
  JOIN public.permissions permission ON permission.key = ANY (ARRAY['crm.notes.edit_all', 'crm.notes.delete_all', 'crm.attachments.delete'])
 WHERE role.is_system AND role.slug = ANY (ARRAY['sales_manager', 'sales_head', 'sales_operations', 'crm_administrator', 'system_administrator'])
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0017_crm_notes_attachments.sql', 'crm-notes-attachments');
