-- The worker closes workspaces whose closure waiting period has ended (Shared Platform plan): the organization is marked closed and its
-- members' sessions are revoked. The worker's role may only read the organization directory, and the memberships it must look at are
-- behind row-level security without a company context, so the work is done by one owner-run function the worker may call.
CREATE OR REPLACE FUNCTION public.close_due_workspaces(p_limit integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  closed_ids uuid[];
BEGIN
  WITH due AS (
    UPDATE public.organizations SET status = 'closed', closed_at = now(), updated_at = now()
     WHERE id IN (SELECT id FROM public.organizations WHERE closure_scheduled_for <= now() AND closed_at IS NULL
                   ORDER BY closure_scheduled_for LIMIT GREATEST(1, LEAST(p_limit, 100)))
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO closed_ids FROM due;

  IF cardinality(closed_ids) > 0 THEN
    UPDATE public.sessions SET revoked_at = now(), revoked_reason = 'workspace_closed'
     WHERE revoked_at IS NULL
       AND user_id IN (SELECT user_id FROM public.organization_memberships WHERE organization_id = ANY (closed_ids));
  END IF;
  RETURN cardinality(closed_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.close_due_workspaces(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_due_workspaces(integer) TO vercent_worker;
