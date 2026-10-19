-- Shared Platform plan, step 8: scale and safety.
--
-- 1. The worker asks one question per poll — which companies have something due? — instead of visiting every company: due or
--    abandoned jobs, events to fan out, automation runs, and webhook deliveries to send. Oldest work first; inactive companies never.
CREATE OR REPLACE FUNCTION public.worker_due_organizations(p_limit integer DEFAULT 500)
  RETURNS TABLE (organization_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path TO 'public', 'tenant', 'pg_temp'
AS $$
  SELECT due.organization_id
    FROM (
      SELECT job.organization_id, min(job.run_at) AS due_at FROM tenant.background_jobs job
       WHERE (job.status = 'pending' AND job.run_at <= now()) OR (job.status = 'processing' AND job.lease_expires_at < now())
       GROUP BY job.organization_id
      UNION ALL
      SELECT event.organization_id, min(event.occurred_at) FROM tenant.platform_events event WHERE event.dispatch_status = 'pending' GROUP BY event.organization_id
      UNION ALL
      SELECT run.organization_id, min(run.created_at) FROM public.workflow_runs run
       WHERE run.status = 'pending' OR (run.status = 'running' AND run.started_at < now() - interval '5 minutes') GROUP BY run.organization_id
      UNION ALL
      SELECT delivery.organization_id, min(COALESCE(delivery.next_attempt_at, delivery.created_at)) FROM tenant.webhook_deliveries delivery
       WHERE (delivery.status IN ('pending', 'retry') AND COALESCE(delivery.next_attempt_at, now()) <= now())
          OR (delivery.status = 'processing' AND delivery.locked_at < now() - interval '5 minutes')
       GROUP BY delivery.organization_id
    ) due
    JOIN public.organizations organization ON organization.id = due.organization_id AND organization.status = 'active'
   GROUP BY due.organization_id
   ORDER BY min(due.due_at)
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 500), 5000))
$$;
REVOKE ALL ON FUNCTION public.worker_due_organizations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.worker_due_organizations(integer) TO vercent_worker;

-- 2. Pruning: finished history is kept for a while, then removed in batches (each call removes at most p_batch rows per kind).
--      jobs           completed or cancelled after 30 days, dead after 90
--      events         dispatched after 90 days, once none of their webhook deliveries is still to be sent
--      runs           automation runs finished after 90 days
--      notifications  read after 180 days, unread after 365
--      mail log       sent, failed or bounced after 180 days (no content is kept on them)
--      sign-in states used or expired after 1 day
CREATE OR REPLACE FUNCTION public.prune_platform_history(p_batch integer DEFAULT 5000)
  RETURNS TABLE (kind text, removed bigint)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path TO 'public', 'tenant', 'pg_temp'
AS $$
DECLARE
  batch integer := GREATEST(1, LEAST(COALESCE(p_batch, 5000), 50000));
  n bigint;
BEGIN
  DELETE FROM tenant.background_jobs WHERE id IN (SELECT id FROM tenant.background_jobs
    WHERE (status IN ('completed', 'cancelled') AND COALESCE(completed_at, updated_at) < now() - interval '30 days') OR (status = 'dead' AND updated_at < now() - interval '90 days') LIMIT batch);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'jobs'; removed := n; RETURN NEXT;

  DELETE FROM tenant.platform_events WHERE id IN (SELECT event.id FROM tenant.platform_events event
    WHERE event.dispatch_status = 'dispatched' AND event.dispatched_at < now() - interval '90 days'
      AND NOT EXISTS (SELECT 1 FROM tenant.webhook_deliveries delivery WHERE delivery.event_id = event.id AND delivery.status IN ('pending', 'processing', 'retry'))
    LIMIT batch);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'events'; removed := n; RETURN NEXT;

  DELETE FROM public.workflow_runs WHERE id IN (SELECT id FROM public.workflow_runs WHERE status IN ('succeeded', 'failed') AND finished_at < now() - interval '90 days' LIMIT batch);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'workflow_runs'; removed := n; RETURN NEXT;

  DELETE FROM public.notifications WHERE id IN (SELECT id FROM public.notifications
    WHERE (read_at IS NOT NULL AND read_at < now() - interval '180 days') OR (read_at IS NULL AND created_at < now() - interval '365 days') LIMIT batch);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'notifications'; removed := n; RETURN NEXT;

  DELETE FROM public.mail_log WHERE id IN (SELECT id FROM public.mail_log WHERE status IN ('sent', 'failed', 'bounced', 'not_configured') AND created_at < now() - interval '180 days' LIMIT batch);
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'mail_log'; removed := n; RETURN NEXT;

  DELETE FROM public.auth_sign_in_states WHERE (used_at IS NOT NULL OR expires_at < now()) AND created_at < now() - interval '1 day';
  GET DIAGNOSTICS n = ROW_COUNT; kind := 'sign_in_states'; removed := n; RETURN NEXT;
END
$$;
REVOKE ALL ON FUNCTION public.prune_platform_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_platform_history(integer) TO vercent_worker;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0192_platform_worker_queue_pruning.sql', 'platform-worker-queue-pruning') ON CONFLICT DO NOTHING;
