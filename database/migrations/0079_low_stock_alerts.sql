-- Low-Stock Alerts: the Reorder Level calculation turned into alerts people act on. There is no second threshold or formula: an alert is a
-- function of an enabled reorder rule's status projection (tenant.inventory_reorder_status), evaluated every time that projection changes.
--
--   out_of_stock             no eligible stock at all (even if confirmed incoming will cover it)            critical
--   replenishment_required   projected position (after confirmed incoming) ≤ reorder level                    high
--   low_stock                current position ≤ reorder level, confirmed incoming lifts it above              warning
--
-- One live occurrence per rule: open → acknowledged (someone took responsibility; the stock is unchanged) → resolved by itself when the
-- condition clears or the rule is disabled. A worse condition escalates the same occurrence (and asks for attention again); a better one
-- de-escalates it. When a cleared condition returns, a new occurrence opens. Snapshots record what was detected; current figures always
-- come from the reorder status. A meaningful transition (opened, reopened, escalated) queues one in-app notification, delivered by the
-- worker to the users allowed to see that warehouse's alerts. Nothing here moves stock or touches valuation.

-- ============================================================ 1. occurrences
CREATE TABLE IF NOT EXISTS tenant.inventory_low_stock_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  rule_id uuid NOT NULL REFERENCES tenant.inventory_reorder_rules(id),
  warehouse_id uuid NOT NULL REFERENCES tenant.warehouses(id),
  item_id uuid NOT NULL REFERENCES tenant.items(id),
  occurrence_number integer NOT NULL DEFAULT 1,
  condition_type text NOT NULL CHECK (condition_type IN ('low_stock', 'replenishment_required', 'out_of_stock')),
  severity text NOT NULL CHECK (severity IN ('warning', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  negative_stock boolean NOT NULL DEFAULT false,
  overdue_incoming boolean NOT NULL DEFAULT false,
  first_detected_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  condition_since timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text CHECK (resolution_reason IS NULL OR resolution_reason IN ('condition_cleared', 'incoming_confirmed', 'stock_increased', 'demand_reduced',
    'policy_changed', 'reorder_rule_disabled', 'reconciled')),
  detected_eligible_on_hand numeric(20,6) NOT NULL,
  detected_firm_demand numeric(20,6) NOT NULL,
  detected_current_position numeric(20,6) NOT NULL,
  detected_firm_incoming numeric(20,6) NOT NULL,
  detected_projected_position numeric(20,6) NOT NULL,
  detected_reorder_level numeric(20,6) NOT NULL,
  detected_target_level numeric(20,6) NOT NULL,
  detected_suggested_quantity numeric(20,6) NOT NULL,
  reorder_status_version integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version integer NOT NULL DEFAULT 1
);
-- One live alert per rule (company, warehouse, item): recalculation updates it, never adds another.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_low_stock_alerts_live_uidx ON tenant.inventory_low_stock_alerts (rule_id) WHERE status <> 'resolved';
CREATE UNIQUE INDEX IF NOT EXISTS inventory_low_stock_alerts_occurrence_uidx ON tenant.inventory_low_stock_alerts (rule_id, occurrence_number);
CREATE INDEX IF NOT EXISTS inventory_low_stock_alerts_list_idx ON tenant.inventory_low_stock_alerts (organization_id, status, severity, warehouse_id);
CREATE INDEX IF NOT EXISTS inventory_low_stock_alerts_item_idx ON tenant.inventory_low_stock_alerts (organization_id, item_id, warehouse_id);

-- ============================================================ 2. history: condition changes, and what people did
CREATE TABLE IF NOT EXISTS tenant.inventory_low_stock_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES tenant.inventory_low_stock_alerts(id),
  event_type text NOT NULL CHECK (event_type IN ('opened', 'reopened', 'escalated', 'deescalated', 'acknowledged', 'resolved')),
  previous_condition text,
  new_condition text,
  previous_severity text,
  new_severity text,
  reorder_status_version integer,
  reason text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_low_stock_alert_events_idx ON tenant.inventory_low_stock_alert_events (organization_id, alert_id, created_at);

CREATE TABLE IF NOT EXISTS tenant.inventory_low_stock_alert_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES tenant.inventory_low_stock_alerts(id),
  action_type text NOT NULL CHECK (action_type IN ('acknowledged', 'purchase_draft_created', 'transfer_draft_created', 'rule_updated')),
  document_type text,
  document_id uuid,
  document_number text,
  base_quantity numeric(20,6),
  notes text,
  performed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS inventory_low_stock_alert_actions_idx ON tenant.inventory_low_stock_alert_actions (organization_id, alert_id, performed_at);

-- One notification per meaningful transition (the event that caused it), delivered by the worker.
CREATE TABLE IF NOT EXISTS tenant.inventory_low_stock_alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  alert_id uuid NOT NULL REFERENCES tenant.inventory_low_stock_alerts(id),
  event_id uuid NOT NULL UNIQUE REFERENCES tenant.inventory_low_stock_alert_events(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispatched')),
  recipients integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  dispatched_at timestamptz
);
CREATE INDEX IF NOT EXISTS inventory_low_stock_alert_notifications_pending_idx ON tenant.inventory_low_stock_alert_notifications (organization_id, created_at) WHERE status = 'pending';

-- ============================================================ 3. the evaluator (one decision, from the reorder status)
-- Evaluates one rule's alert from its current status. The previous planning figures (when known) say why a resolution happened.
CREATE OR REPLACE FUNCTION tenant.evaluate_low_stock_alert(p_rule uuid, p_prev_eligible numeric DEFAULT NULL, p_prev_demand numeric DEFAULT NULL, p_prev_incoming numeric DEFAULT NULL)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  rule record;
  state record;
  live record;
  cond text;
  sev text;
  rank_new integer;
  rank_old integer;
  next_occurrence integer;
  alert_id uuid;
  event_id uuid;
  reason text;
  facts jsonb;
BEGIN
  SELECT * INTO rule FROM tenant.inventory_reorder_rules WHERE id = p_rule;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO state FROM tenant.inventory_reorder_status WHERE rule_id = p_rule;
  -- The hierarchy: out of stock, then replenishment required, then low stock (covered), else no alert.
  IF NOT rule.enabled OR state.rule_id IS NULL OR state.status = 'disabled' THEN cond := NULL;
  ELSIF state.eligible_on_hand <= 0 THEN cond := 'out_of_stock';
  ELSIF state.status IN ('reorder_required', 'out_of_stock') THEN cond := 'replenishment_required';
  ELSIF state.status = 'below_reorder_covered' THEN cond := 'low_stock';
  ELSE cond := NULL;
  END IF;
  sev := CASE cond WHEN 'out_of_stock' THEN 'critical' WHEN 'replenishment_required' THEN 'high' WHEN 'low_stock' THEN 'warning' END;
  rank_new := CASE cond WHEN 'out_of_stock' THEN 3 WHEN 'replenishment_required' THEN 2 WHEN 'low_stock' THEN 1 ELSE 0 END;
  IF state.rule_id IS NOT NULL THEN
    facts := jsonb_build_object('eligible', state.eligible_on_hand, 'demand', state.firm_open_demand, 'current', state.current_planning_position,
      'incoming', state.firm_incoming, 'projected', state.projected_position, 'reorder', rule.reorder_level_base_quantity, 'target', rule.target_level_base_quantity,
      'suggested', state.suggested_base_quantity, 'nextIncoming', state.earliest_incoming_date, 'overdue', state.overdue_incoming);
  END IF;

  SELECT * INTO live FROM tenant.inventory_low_stock_alerts WHERE rule_id = p_rule AND status <> 'resolved' FOR UPDATE;

  IF cond IS NULL THEN
    IF live.id IS NOT NULL THEN
      reason := CASE
        WHEN NOT rule.enabled OR state.status = 'disabled' THEN 'reorder_rule_disabled'
        WHEN p_prev_eligible IS NULL THEN 'condition_cleared'
        WHEN (p_prev_eligible, p_prev_demand, p_prev_incoming) IS NOT DISTINCT FROM (state.eligible_on_hand, state.firm_open_demand, state.firm_incoming) THEN 'policy_changed'
        WHEN state.firm_incoming > p_prev_incoming THEN 'incoming_confirmed'
        WHEN state.eligible_on_hand > p_prev_eligible THEN 'stock_increased'
        WHEN state.firm_open_demand < p_prev_demand THEN 'demand_reduced'
        ELSE 'condition_cleared' END;
      UPDATE tenant.inventory_low_stock_alerts SET status = 'resolved', resolved_at = clock_timestamp(), resolution_reason = reason, last_evaluated_at = clock_timestamp(),
             reorder_status_version = state.version, updated_at = clock_timestamp(), version = version + 1 WHERE id = live.id;
      INSERT INTO tenant.inventory_low_stock_alert_events (organization_id, alert_id, event_type, previous_condition, previous_severity, reorder_status_version, reason, details)
      VALUES (rule.organization_id, live.id, 'resolved', live.condition_type, live.severity, state.version, reason, COALESCE(facts, '{}'::jsonb));
    END IF;
    RETURN NULL;
  END IF;

  IF live.id IS NULL THEN
    SELECT COALESCE(max(occurrence_number), 0) + 1 INTO next_occurrence FROM tenant.inventory_low_stock_alerts WHERE rule_id = p_rule;
    INSERT INTO tenant.inventory_low_stock_alerts (organization_id, rule_id, warehouse_id, item_id, occurrence_number, condition_type, severity, negative_stock, overdue_incoming,
        detected_eligible_on_hand, detected_firm_demand, detected_current_position, detected_firm_incoming, detected_projected_position, detected_reorder_level,
        detected_target_level, detected_suggested_quantity, reorder_status_version)
    VALUES (rule.organization_id, p_rule, rule.warehouse_id, rule.item_id, next_occurrence, cond, sev, state.eligible_on_hand < 0, state.overdue_incoming,
        state.eligible_on_hand, state.firm_open_demand, state.current_planning_position, state.firm_incoming, state.projected_position, rule.reorder_level_base_quantity,
        rule.target_level_base_quantity, state.suggested_base_quantity, state.version)
    RETURNING id INTO alert_id;
    INSERT INTO tenant.inventory_low_stock_alert_events (organization_id, alert_id, event_type, new_condition, new_severity, reorder_status_version, details)
    VALUES (rule.organization_id, alert_id, CASE WHEN next_occurrence > 1 THEN 'reopened' ELSE 'opened' END, cond, sev, state.version, facts || jsonb_build_object('occurrence', next_occurrence))
    RETURNING id INTO event_id;
    INSERT INTO tenant.inventory_low_stock_alert_notifications (organization_id, alert_id, event_id) VALUES (rule.organization_id, alert_id, event_id);
    RETURN cond;
  END IF;

  rank_old := CASE live.condition_type WHEN 'out_of_stock' THEN 3 WHEN 'replenishment_required' THEN 2 ELSE 1 END;
  IF cond IS DISTINCT FROM live.condition_type THEN
    -- A worse condition asks for attention again (an acknowledged alert reopens); a better one simply de-escalates.
    UPDATE tenant.inventory_low_stock_alerts SET condition_type = cond, severity = sev, condition_since = clock_timestamp(),
           status = CASE WHEN rank_new > rank_old THEN 'open' ELSE status END,
           negative_stock = state.eligible_on_hand < 0, overdue_incoming = state.overdue_incoming, last_evaluated_at = clock_timestamp(), reorder_status_version = state.version,
           updated_at = clock_timestamp(), version = version + 1 WHERE id = live.id;
    INSERT INTO tenant.inventory_low_stock_alert_events (organization_id, alert_id, event_type, previous_condition, new_condition, previous_severity, new_severity, reorder_status_version, details)
    VALUES (rule.organization_id, live.id, CASE WHEN rank_new > rank_old THEN 'escalated' ELSE 'deescalated' END, live.condition_type, cond, live.severity, sev, state.version, facts)
    RETURNING id INTO event_id;
    IF rank_new > rank_old THEN
      INSERT INTO tenant.inventory_low_stock_alert_notifications (organization_id, alert_id, event_id) VALUES (rule.organization_id, live.id, event_id);
    END IF;
  ELSIF (live.negative_stock, live.overdue_incoming, live.reorder_status_version) IS DISTINCT FROM (state.eligible_on_hand < 0, state.overdue_incoming, state.version) THEN
    -- Same condition: the figures moved. No event, no notification.
    UPDATE tenant.inventory_low_stock_alerts SET negative_stock = state.eligible_on_hand < 0, overdue_incoming = state.overdue_incoming, last_evaluated_at = clock_timestamp(),
           reorder_status_version = state.version, updated_at = clock_timestamp() WHERE id = live.id;
  END IF;
  RETURN cond;
END;
$$;

-- Evaluated whenever a rule's status projection changes (the status only changes when its figures do, so repeating a calculation is a no-op).
CREATE OR REPLACE FUNCTION tenant.low_stock_on_reorder_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN PERFORM tenant.evaluate_low_stock_alert(NEW.rule_id);
  ELSE PERFORM tenant.evaluate_low_stock_alert(NEW.rule_id, OLD.eligible_on_hand, OLD.firm_open_demand, OLD.firm_incoming);
  END IF;
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER inventory_reorder_status_low_stock AFTER INSERT OR UPDATE ON tenant.inventory_reorder_status
  FOR EACH ROW EXECUTE FUNCTION tenant.low_stock_on_reorder_status();
-- A rule disabled or re-enabled with no change to its figures still changes its status ('disabled'); a rule whose thresholds change is
-- re-evaluated even when the status row stays the same.
CREATE OR REPLACE FUNCTION tenant.low_stock_on_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  state record;
BEGIN
  SELECT eligible_on_hand, firm_open_demand, firm_incoming INTO state FROM tenant.inventory_reorder_status WHERE rule_id = NEW.id;
  PERFORM tenant.evaluate_low_stock_alert(NEW.id, state.eligible_on_hand, state.firm_open_demand, state.firm_incoming);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE TRIGGER inventory_reorder_rules_low_stock AFTER UPDATE OF enabled, reorder_level_base_quantity, target_level_base_quantity, order_multiple_base_quantity
  ON tenant.inventory_reorder_rules FOR EACH ROW EXECUTE FUNCTION tenant.low_stock_on_rule();

-- Rules that already exist get their alerts now.
DO $$
DECLARE
  rule record;
BEGIN
  FOR rule IN SELECT id FROM tenant.inventory_reorder_rules LOOP
    PERFORM tenant.evaluate_low_stock_alert(rule.id);
  END LOOP;
END $$;

-- ============================================================ 4. isolation and grants
DO $$
DECLARE
  name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['inventory_low_stock_alerts', 'inventory_low_stock_alert_events', 'inventory_low_stock_alert_actions', 'inventory_low_stock_alert_notifications'] LOOP
    EXECUTE format('ALTER TABLE tenant.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('ALTER TABLE tenant.%I FORCE ROW LEVEL SECURITY', name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'tenant' AND tablename = name AND policyname = 'organization_isolation') THEN
      EXECUTE format('CREATE POLICY organization_isolation ON tenant.%I USING (organization_id = tenant.current_organization_id()) WITH CHECK (organization_id = tenant.current_organization_id())', name);
    END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_app', name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON tenant.%I TO vercent_worker', name);
  END LOOP;
END $$;
-- Occurrences are resolved, never deleted; history and actions are evidence.
REVOKE DELETE ON tenant.inventory_low_stock_alerts FROM vercent_app;
REVOKE UPDATE, DELETE ON tenant.inventory_low_stock_alert_events, tenant.inventory_low_stock_alert_actions FROM vercent_app;
REVOKE UPDATE, DELETE ON tenant.inventory_low_stock_alert_events, tenant.inventory_low_stock_alert_actions FROM vercent_worker;

-- ============================================================ 5. permissions
INSERT INTO public.permissions (key, name, category, description) VALUES
  ('stock.alerts.view', 'View low-stock alerts', 'Inventory', 'See low-stock, replenishment-required and out-of-stock alerts for the warehouses you can see, and receive their notifications.'),
  ('stock.alerts.acknowledge', 'Acknowledge low-stock alerts', 'Inventory', 'Take responsibility for an alert (the stock condition is unchanged).'),
  ('stock.alerts.view_history', 'View low-stock alert history', 'Inventory', 'See how an alert opened, escalated, was acted on and resolved.'),
  ('stock.alerts.export', 'Export low-stock alerts', 'Inventory', 'Download alerts.')
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.role_permissions (role_id, permission_key)
SELECT DISTINCT existing.role_id, granted.key FROM public.role_permissions existing
  JOIN (VALUES ('stock.view', 'stock.alerts.view'), ('stock.view', 'stock.alerts.view_history'),
               ('stock.adjust', 'stock.alerts.acknowledge'), ('inventory_setup.manage', 'stock.alerts.view'), ('inventory_setup.manage', 'stock.alerts.acknowledge'),
               ('inventory_setup.manage', 'stock.alerts.view_history'), ('inventory_setup.manage', 'stock.alerts.export'),
               ('procurement.po.create', 'stock.alerts.view'), ('procurement.po.create', 'stock.alerts.acknowledge'), ('procurement.po.create', 'stock.alerts.view_history'),
               ('procurement.po.create', 'stock.alerts.export'), ('stock.transfers.create', 'stock.alerts.view'), ('stock.transfers.create', 'stock.alerts.acknowledge'))
       AS granted(source, key) ON granted.source = existing.permission_key
  JOIN public.permissions permission ON permission.key = granted.key
ON CONFLICT DO NOTHING;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0079_low_stock_alerts.sql', 'low-stock-alerts');
