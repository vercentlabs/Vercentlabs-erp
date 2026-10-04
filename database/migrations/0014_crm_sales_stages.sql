-- CRM Sales Stages: the steps an open opportunity moves through.
--
--   1. Stage description and guidance — what a stage means and what to do in it
--   2. Stage history — the probability before the move, beside the one after
--   3. Descriptions for the five standard stages of workspaces that already exist
--
-- The stages themselves, their sequence, their default probability and the
-- stage history are already there (crm_pipeline_stages,
-- crm_opportunity_stage_history); this adds to them and removes nothing.
--
-- Run once, after 0013_crm_opportunity_pipeline.sql.

SELECT pg_catalog.set_config('search_path', '', false);

-- ============================================================ 1. description and guidance

ALTER TABLE tenant.crm_pipeline_stages
  -- one or two lines: when a deal belongs in this stage
  ADD COLUMN description text,
  -- the goals of the stage, one per line
  ADD COLUMN guidance text,
  ADD CONSTRAINT crm_pipeline_stages_description_check CHECK (description IS NULL OR char_length(description) <= 500),
  ADD CONSTRAINT crm_pipeline_stages_guidance_check CHECK (guidance IS NULL OR char_length(guidance) <= 2000);

-- ============================================================ 2. stage history

-- Empty for moves recorded before this column existed.
ALTER TABLE tenant.crm_opportunity_stage_history
  ADD COLUMN probability_before numeric(5,2),
  ADD CONSTRAINT crm_opportunity_stage_history_probability_before_check CHECK (probability_before IS NULL OR (probability_before >= 0 AND probability_before <= 100));

-- ============================================================ 3. the standard stages

-- Only where nothing has been written yet; a stage keeps the text its organization gave it.
UPDATE tenant.crm_pipeline_stages stage
   SET description = standard.description, guidance = standard.guidance
  FROM (VALUES
    ('DISCOVERY', 'The opportunity has been created and you are understanding the customer''s situation.',
     E'Understand the business problem\nIdentify the stakeholders\nUnderstand the high-level scope\nEstablish whether the deal is real'),
    ('NEEDS_ANALYSIS', 'You are working out the detailed requirements.',
     E'Confirm what is needed: modules, users, locations, processes\nUnderstand implementation and technical requirements\nUnderstand the decision process and commercial constraints'),
    ('PROPOSAL', 'Use when a formal solution and pricing proposal has been prepared or presented to the customer.',
     E'Define the scope and the solution\nCreate the quotation\nShare the pricing\nPresent the proposal or demo'),
    ('NEGOTIATION', 'The customer is actively discussing commercial or contractual terms.',
     E'Confirm the final scope\nResolve pricing and discounts\nAgree payment terms\nAgree the implementation schedule'),
    ('CLOSING', 'The deal is near its final decision. It stays open until the outcome is confirmed.',
     E'Get the final approval or purchase order\nGet the final quotation accepted\nGet the contract signed\nThen mark the opportunity won or lost')
  ) AS standard (code, description, guidance)
 WHERE stage.code = standard.code AND stage.description IS NULL AND stage.guidance IS NULL AND NOT stage.is_won AND NOT stage.is_lost;

INSERT INTO public.schema_migrations (filename, checksum) VALUES ('0014_crm_sales_stages.sql', 'crm-sales-stages');
