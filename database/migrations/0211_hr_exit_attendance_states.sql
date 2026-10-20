-- HR — employee exit / relieving and the remaining attendance states (MVP 40). Additive:
--   1. payroll eligibility on the employee, kept apart from employment status (a consultant on the master who is not paid through payroll,
--      or an employee whose pay is stopped);
--   2. the exit record (hr_separations, already present) gains its final-settlement status: pending until the final payslip is paid and
--      every settlement earning / deduction is paid or withdrawn, then settled (or not required) by someone with hr_payroll.exit.settle;
--   3. attendance: INCOMPLETE (a missing punch on a past day) and PENDING_CORRECTION (a correction requested and not decided) join the
--      daily states; LATE stays a flag next to the status (is_late, from the late minutes), so a late day is still present;
--   4. attendance corrections (hr_attendance_regularizations, already present) keep the punches they added, and the original punches stay.
-- Re-runnable.

-- ============================================================ 1. payroll eligibility
ALTER TABLE tenant.hr_employees ADD COLUMN IF NOT EXISTS payroll_eligible boolean NOT NULL DEFAULT true;

-- ============================================================ 2. exit and final settlement
ALTER TABLE tenant.hr_separations
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settled_by uuid,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_note text,
  ADD COLUMN IF NOT EXISTS final_payslip_id uuid,
  ADD COLUMN IF NOT EXISTS withdrawn_reason text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hr_separations_settlement_status_check') THEN
    ALTER TABLE tenant.hr_separations ADD CONSTRAINT hr_separations_settlement_status_check CHECK (settlement_status IN ('pending', 'settled', 'not_required'));
  END IF;
END $$;
-- one open exit per employee
CREATE UNIQUE INDEX IF NOT EXISTS hr_separations_open_uidx ON tenant.hr_separations (employee_id) WHERE status IN ('submitted', 'accepted');

-- ============================================================ 3. attendance states
ALTER TABLE tenant.hr_attendance DROP CONSTRAINT IF EXISTS hr_attendance_status_check;
ALTER TABLE tenant.hr_attendance ADD CONSTRAINT hr_attendance_status_check
  CHECK (status IN ('present', 'absent', 'half_day', 'leave', 'holiday', 'weekly_off', 'remote', 'incomplete', 'pending_correction'));
ALTER TABLE tenant.hr_attendance ADD COLUMN IF NOT EXISTS is_late boolean GENERATED ALWAYS AS (late_minutes > 0) STORED;
-- a day recorded as absent only because its check-out was missing is incomplete
UPDATE tenant.hr_attendance SET status = 'incomplete' WHERE status = 'absent' AND check_in_at IS NOT NULL AND check_out_at IS NULL AND leave_request_id IS NULL;

-- ============================================================ 4. corrections
ALTER TABLE tenant.hr_attendance_regularizations ADD COLUMN IF NOT EXISTS added_punch_ids uuid[] NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS hr_attendance_regularizations_open_uidx ON tenant.hr_attendance_regularizations (employee_id, attendance_date) WHERE status = 'pending';
GRANT SELECT, INSERT, UPDATE ON tenant.hr_attendance_regularizations TO vercent_app, vercent_worker;
GRANT SELECT, INSERT, UPDATE ON tenant.hr_separations TO vercent_app, vercent_worker;

-- ============================================================ permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('hr_payroll.exit.settle', 'Settle exits', 'HR & Payroll', 'Mark a leaving employee''s final settlement as settled or not required.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT role.id, 'hr_payroll.exit.settle' FROM public.roles role
WHERE role.slug IN ('hr_manager', 'finance_manager', 'system_administrator', 'organization_owner')
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0211_hr_exit_attendance_states.sql', 'hr-exit-attendance-states') ON CONFLICT DO NOTHING;
