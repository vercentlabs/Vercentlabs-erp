-- Projects — Comments and Collaboration. One permission-aware discussion beside the work: comments on a project, a task or a milestone, with
-- one level of replies, @mentions of eligible people, files, an edit history, soft deletion, follow/unfollow, per-person read markers and
-- notifications sent once. A comment is communication — it never completes a task, approves a milestone or posts anything.
--
--   1. comments        the discussion record: its project, its parent (PROJECT / TASK / MILESTONE), the comment it replies to (one level),
--                      the current text, its visibility (inherited from the parent, or restricted to authorized managers), the author, the
--                      version, a monotonic sequence (read markers and unread counts), soft-deletion metadata and the creation key.
--   2. versions        every text the comment ever had, append-only, with its mentions and files at that version.
--   3. mentions        the people mentioned, by user id (never by name), with the version that mentioned them.
--   4. attachments     files on a comment: uploaded to it, or a reference to a file already on its parent record (never a wider access).
--   5. follows         who follows a discussion (or muted it); assignees, owners and managers follow implicitly unless muted.
--   6. read markers    the last sequence a person has seen in a discussion.
--   7. notifications   one row per comment and person told, so the same comment never notifies the same person twice.
--   8. policy          the edit window and the maximum length.
--   9. history         the task comments (0129) and milestone notes (0128) become comments of their task and milestone.
--  10. permissions     view, create, reply, edit own, delete own, moderate, history, restricted view/create, attach, mention, export.

-- ============================================================ 1. comments
CREATE TABLE IF NOT EXISTS tenant.project_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  parent_type text NOT NULL CHECK (parent_type IN ('PROJECT', 'TASK', 'MILESTONE')),
  parent_id uuid NOT NULL,
  reply_to_id uuid REFERENCES tenant.project_comments(id),
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'INHERIT' CHECK (visibility IN ('INHERIT', 'RESTRICTED')),
  author_user_id uuid REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  edited_at timestamptz,
  edited_by uuid REFERENCES public.users(id),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.users(id),
  delete_reason text,
  idempotency_key text,
  search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED,
  CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  CHECK ((status = 'DELETED') = (deleted_at IS NOT NULL)),
  CHECK (parent_type <> 'PROJECT' OR parent_id = project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS project_comments_key_idx ON tenant.project_comments (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_comments_thread_idx ON tenant.project_comments (organization_id, parent_type, parent_id, sequence);
CREATE INDEX IF NOT EXISTS project_comments_project_idx ON tenant.project_comments (organization_id, project_id, sequence DESC);
CREATE INDEX IF NOT EXISTS project_comments_reply_idx ON tenant.project_comments (organization_id, reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_comments_author_idx ON tenant.project_comments (organization_id, author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_comments_search_idx ON tenant.project_comments USING gin (search);

-- ============================================================ 2. versions
CREATE TABLE IF NOT EXISTS tenant.project_comment_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  comment_id uuid NOT NULL REFERENCES tenant.project_comments(id),
  version_number integer NOT NULL,
  body_snapshot text NOT NULL,
  mention_user_ids uuid[] NOT NULL DEFAULT '{}',
  attachment_ids uuid[] NOT NULL DEFAULT '{}',
  edited_by uuid REFERENCES public.users(id),
  edited_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  change_reason text,
  UNIQUE (comment_id, version_number)
);

-- ============================================================ 3. mentions
CREATE TABLE IF NOT EXISTS tenant.project_comment_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  comment_id uuid NOT NULL REFERENCES tenant.project_comments(id),
  mentioned_user_id uuid NOT NULL REFERENCES public.users(id),
  comment_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  UNIQUE (comment_id, mentioned_user_id)
);
CREATE INDEX IF NOT EXISTS project_comment_mentions_user_idx ON tenant.project_comment_mentions (organization_id, mentioned_user_id, created_at DESC) WHERE removed_at IS NULL;

-- ============================================================ 4. attachments
CREATE TABLE IF NOT EXISTS tenant.project_comment_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  comment_id uuid NOT NULL REFERENCES tenant.project_comments(id),
  attachment_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('UPLOADED', 'REFERENCED')),
  added_by uuid REFERENCES public.users(id),
  added_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed_at timestamptz,
  removed_by uuid REFERENCES public.users(id),
  UNIQUE (comment_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS project_comment_attachments_comment_idx ON tenant.project_comment_attachments (organization_id, comment_id) WHERE removed_at IS NULL;

-- ============================================================ 5. follows
CREATE TABLE IF NOT EXISTS tenant.project_comment_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  project_id uuid NOT NULL REFERENCES tenant.projects(id),
  parent_type text NOT NULL CHECK (parent_type IN ('PROJECT', 'TASK', 'MILESTONE')),
  parent_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'FOLLOWING' CHECK (status IN ('FOLLOWING', 'MUTED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organization_id, user_id, parent_type, parent_id)
);
CREATE INDEX IF NOT EXISTS project_comment_subscriptions_parent_idx ON tenant.project_comment_subscriptions (organization_id, parent_type, parent_id);

-- ============================================================ 6. read markers
CREATE TABLE IF NOT EXISTS tenant.project_comment_read_markers (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id),
  parent_type text NOT NULL CHECK (parent_type IN ('PROJECT', 'TASK', 'MILESTONE')),
  parent_id uuid NOT NULL,
  last_sequence bigint NOT NULL DEFAULT 0,
  read_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (organization_id, user_id, parent_type, parent_id)
);

-- ============================================================ 7. notifications sent
CREATE TABLE IF NOT EXISTS tenant.project_comment_notifications (
  organization_id uuid NOT NULL,
  comment_id uuid NOT NULL REFERENCES tenant.project_comments(id),
  user_id uuid NOT NULL REFERENCES public.users(id),
  reason text NOT NULL CHECK (reason IN ('MENTION', 'REPLY', 'FOLLOWING')),
  sent_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (comment_id, user_id)
);

-- ============================================================ 8. policy
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS comment_edit_window_minutes integer NOT NULL DEFAULT 1440 CHECK (comment_edit_window_minutes BETWEEN 0 AND 43200);
ALTER TABLE tenant.project_settings ADD COLUMN IF NOT EXISTS comment_max_length integer NOT NULL DEFAULT 5000 CHECK (comment_max_length BETWEEN 200 AND 20000);

-- ============================================================ the guard
-- A reply is one level deep, on the same record as the comment it answers, and never wider than it (a reply to a restricted comment is
-- restricted). A comment keeps its record, author and creation; a deleted comment stays deleted. Versions and mentions are never deleted.
CREATE OR REPLACE FUNCTION tenant.project_comments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A comment is removed by soft deletion, never deleted.' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.parent_type <> OLD.parent_type OR NEW.parent_id <> OLD.parent_id OR NEW.project_id <> OLD.project_id OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
       OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id OR NEW.created_at <> OLD.created_at OR NEW.organization_id <> OLD.organization_id THEN
      RAISE EXCEPTION 'A comment keeps its record, its thread and its author.' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'DELETED' AND NEW.status <> 'DELETED' THEN
      RAISE EXCEPTION 'A removed comment stays removed.' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.reply_to_id IS NOT NULL THEN
    SELECT * INTO parent FROM tenant.project_comments WHERE id = NEW.reply_to_id;
    IF parent.id IS NULL OR parent.parent_type <> NEW.parent_type OR parent.parent_id <> NEW.parent_id OR parent.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'A reply belongs to the discussion of the comment it answers.' USING ERRCODE = 'check_violation';
    END IF;
    IF parent.reply_to_id IS NOT NULL THEN
      RAISE EXCEPTION 'Replies are one level deep.' USING ERRCODE = 'check_violation';
    END IF;
    IF parent.visibility = 'RESTRICTED' AND NEW.visibility <> 'RESTRICTED' THEN
      RAISE EXCEPTION 'A reply to a restricted comment is restricted.' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_comments_guard' AND tgrelid = 'tenant.project_comments'::regclass) THEN
    CREATE TRIGGER project_comments_guard BEFORE INSERT OR UPDATE OR DELETE ON tenant.project_comments FOR EACH ROW EXECUTE FUNCTION tenant.project_comments_guard();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_comment_versions_append_only' AND tgrelid = 'tenant.project_comment_versions'::regclass) THEN
    CREATE TRIGGER project_comment_versions_append_only BEFORE UPDATE OR DELETE ON tenant.project_comment_versions FOR EACH ROW EXECUTE FUNCTION tenant.projects_append_only();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_comment_mentions_no_delete' AND tgrelid = 'tenant.project_comment_mentions'::regclass) THEN
    CREATE TRIGGER project_comment_mentions_no_delete BEFORE DELETE ON tenant.project_comment_mentions FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'project_comment_attachments_no_delete' AND tgrelid = 'tenant.project_comment_attachments'::regclass) THEN
    CREATE TRIGGER project_comment_attachments_no_delete BEFORE DELETE ON tenant.project_comment_attachments FOR EACH ROW EXECUTE FUNCTION tenant.projects_no_delete();
  END IF;
END $$;

-- ============================================================ 9. history
-- Task comments (0129) become comments of their task; milestone notes (0128, project_notes with a milestone) become comments of their
-- milestone. Each keeps its author, time, removal and mentions; its first version is its text.
INSERT INTO tenant.project_comments (id, organization_id, project_id, parent_type, parent_id, body, author_user_id, status, created_at, deleted_at, deleted_by, idempotency_key)
SELECT old.id, old.organization_id, task.project_id, 'TASK', old.task_id, left(old.body, 20000), old.author_user_id,
       CASE WHEN old.removed_at IS NULL THEN 'ACTIVE' ELSE 'DELETED' END, old.created_at, old.removed_at, old.removed_by, old.idempotency_key
  FROM tenant.project_task_comments old JOIN tenant.project_tasks task ON task.id = old.task_id
 WHERE NOT EXISTS (SELECT 1 FROM tenant.project_comments existing WHERE existing.id = old.id)
 ORDER BY old.created_at;
INSERT INTO tenant.project_comment_mentions (organization_id, comment_id, mentioned_user_id, comment_version, created_at)
SELECT old.organization_id, old.id, mention, 1, old.created_at
  FROM tenant.project_task_comments old CROSS JOIN LATERAL unnest(old.mentions) AS mention
 WHERE EXISTS (SELECT 1 FROM public.users person WHERE person.id = mention)
ON CONFLICT (comment_id, mentioned_user_id) DO NOTHING;
INSERT INTO tenant.project_comments (id, organization_id, project_id, parent_type, parent_id, body, author_user_id, status, created_at, edited_at, deleted_at, deleted_by)
SELECT note.id, note.organization_id, note.project_id, 'MILESTONE', note.milestone_id, left(note.body, 20000), note.author_user_id,
       CASE WHEN note.deleted_at IS NULL THEN 'ACTIVE' ELSE 'DELETED' END, note.created_at, note.edited_at, note.deleted_at, note.deleted_by
  FROM tenant.project_notes note
 WHERE note.milestone_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant.project_comments existing WHERE existing.id = note.id)
 ORDER BY note.created_at;
INSERT INTO tenant.project_comment_versions (organization_id, comment_id, version_number, body_snapshot, mention_user_ids, edited_by, edited_at)
SELECT comment.organization_id, comment.id, 1, comment.body,
       COALESCE((SELECT array_agg(mention.mentioned_user_id) FROM tenant.project_comment_mentions mention WHERE mention.comment_id = comment.id), '{}'),
       comment.author_user_id, comment.created_at
  FROM tenant.project_comments comment
 WHERE NOT EXISTS (SELECT 1 FROM tenant.project_comment_versions version WHERE version.comment_id = comment.id);

-- ============================================================ isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['project_comments', 'project_comment_versions', 'project_comment_mentions', 'project_comment_attachments', 'project_comment_subscriptions',
      'project_comment_read_markers', 'project_comment_notifications'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON tenant.project_comments, tenant.project_comment_mentions, tenant.project_comment_attachments TO vercent_app;
GRANT SELECT, INSERT ON tenant.project_comment_versions, tenant.project_comment_notifications TO vercent_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant.project_comment_subscriptions, tenant.project_comment_read_markers TO vercent_app;
GRANT SELECT ON tenant.project_comments, tenant.project_comment_versions, tenant.project_comment_mentions, tenant.project_comment_attachments, tenant.project_comment_subscriptions,
  tenant.project_comment_read_markers, tenant.project_comment_notifications TO vercent_worker;

-- ============================================================ 10. permissions and roles
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('projects.comments.view', 'View project discussions', 'Projects', 'Read the comments on the projects, tasks and milestones you can see.'),
  ('projects.comments.create', 'Comment on project work', 'Projects', 'Post comments on projects, tasks and milestones you work on.'),
  ('projects.comments.reply', 'Reply to comments', 'Projects', 'Reply to a comment in its discussion.'),
  ('projects.comments.edit_own', 'Edit own comments', 'Projects', 'Correct your own recent comments; every version is kept.'),
  ('projects.comments.delete_own', 'Remove own comments', 'Projects', 'Remove your own comments; the history is kept.'),
  ('projects.comments.moderate', 'Moderate project discussions', 'Projects', 'Remove other people''s comments and post on closed projects.'),
  ('projects.comments.view_history', 'View comment history', 'Projects', 'See earlier versions of edited and removed comments.'),
  ('projects.comments.restricted_view', 'View restricted discussions', 'Projects', 'Read restricted management comments on the projects you lead.'),
  ('projects.comments.restricted_create', 'Post restricted comments', 'Projects', 'Post comments only authorized managers can read.'),
  ('projects.comments.attach', 'Attach files to comments', 'Projects', 'Add files to your comments.'),
  ('projects.comments.mention', 'Mention people in comments', 'Projects', 'Mention team members so they are told.'),
  ('projects.comments.export', 'Export project discussions', 'Projects', 'Export discussions and the collaboration reports.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, grant_row.key FROM public.roles role
  JOIN (VALUES
    ('employee', 'projects.comments.view'), ('employee', 'projects.comments.create'), ('employee', 'projects.comments.reply'), ('employee', 'projects.comments.edit_own'),
    ('employee', 'projects.comments.delete_own'), ('employee', 'projects.comments.attach'), ('employee', 'projects.comments.mention'),
    ('project_manager', 'projects.comments.view'), ('project_manager', 'projects.comments.create'), ('project_manager', 'projects.comments.reply'),
    ('project_manager', 'projects.comments.edit_own'), ('project_manager', 'projects.comments.delete_own'), ('project_manager', 'projects.comments.moderate'),
    ('project_manager', 'projects.comments.view_history'), ('project_manager', 'projects.comments.restricted_view'), ('project_manager', 'projects.comments.restricted_create'),
    ('project_manager', 'projects.comments.attach'), ('project_manager', 'projects.comments.mention'), ('project_manager', 'projects.comments.export'),
    ('finance_manager', 'projects.comments.view'), ('finance_manager', 'projects.comments.create'), ('finance_manager', 'projects.comments.reply'),
    ('finance_manager', 'projects.comments.edit_own'), ('finance_manager', 'projects.comments.delete_own'), ('finance_manager', 'projects.comments.attach'),
    ('finance_manager', 'projects.comments.mention'), ('finance_manager', 'projects.comments.restricted_view'), ('finance_manager', 'projects.comments.restricted_create'),
    ('accountant', 'projects.comments.view'), ('accountant', 'projects.comments.create'), ('accountant', 'projects.comments.reply'), ('accountant', 'projects.comments.edit_own'),
    ('accountant', 'projects.comments.delete_own'), ('accountant', 'projects.comments.attach'), ('accountant', 'projects.comments.mention'),
    ('sales_head', 'projects.comments.view'), ('sales_head', 'projects.comments.create'), ('sales_head', 'projects.comments.reply'), ('sales_head', 'projects.comments.edit_own'),
    ('sales_head', 'projects.comments.delete_own'), ('sales_head', 'projects.comments.attach'), ('sales_head', 'projects.comments.mention'),
    ('sales_manager', 'projects.comments.view'), ('sales_manager', 'projects.comments.create'), ('sales_manager', 'projects.comments.reply'),
    ('sales_manager', 'projects.comments.edit_own'), ('sales_manager', 'projects.comments.delete_own'), ('sales_manager', 'projects.comments.attach'),
    ('sales_manager', 'projects.comments.mention')
  ) AS grant_row(slug, key) ON grant_row.slug = role.slug
  JOIN public.permissions permission ON permission.key = grant_row.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0136_projects_collaboration.sql', 'projects-collaboration') ON CONFLICT DO NOTHING;
