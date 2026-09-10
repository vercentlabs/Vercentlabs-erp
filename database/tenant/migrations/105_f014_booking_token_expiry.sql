BEGIN;

-- Prompt 6 (CRM-CAP-004, F014 — Meetings), DEC-CRM-P1-F014 REQUIRED scope:
-- "booking token expiry." Re-audit confirmed crm_public_meeting_booking()
-- validated a guest's cancellation/reschedule token purely by matching the
-- token string against a 'confirmed' booking — with no time boundedness
-- at all, a token for a meeting that happened years ago (and was never
-- explicitly cancelled) would still validate forever. A leaked/logged
-- token is a live attack surface indefinitely.
--
-- This is NOT the same as crm_meeting_links.public_token (the durable
-- "book a meeting with me" page link, correctly reusable indefinitely by
-- design, like a Calendly link) — that one is intentionally left alone.
--
-- A stored/generated column computed from ends_at + interval was rejected
-- by Postgres ("generation expression is not immutable" — timestamptz +
-- interval arithmetic is not considered IMMUTABLE, since interval units
-- above days can be calendar/timezone-dependent). Computing the same
-- one-day-past-the-meeting expiry inline in the lookup function's WHERE
-- clause avoids that restriction entirely — STABLE functions (this one
-- already is) are allowed to evaluate now()-relative expressions, and the
-- expiry rule lives in exactly one place either way.
CREATE OR REPLACE FUNCTION tenant.crm_public_meeting_booking(token text)
RETURNS TABLE (
  organization_id uuid,
  booking_id uuid,
  host_user_id uuid,
  token_type text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = tenant, public
AS $$
  SELECT booking.organization_id,booking.id,booking.host_user_id,
    CASE WHEN booking.cancellation_token=token THEN 'cancel' ELSE 'reschedule' END
  FROM tenant.crm_meeting_bookings booking
  WHERE booking.status='confirmed'
    AND booking.ends_at > now() - interval '1 day'
    AND (booking.cancellation_token=token OR booking.reschedule_token=token)
  LIMIT 1
$$;

COMMIT;
