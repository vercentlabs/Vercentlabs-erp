BEGIN;

CREATE TABLE IF NOT EXISTS tenant.crm_lead_record_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES public.companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key),
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_lead_record_types_one_default_idx
  ON tenant.crm_lead_record_types(organization_id, coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_default AND status='active';

CREATE TABLE IF NOT EXISTS tenant.crm_lead_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  field_key text NOT NULL CHECK (field_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  label text NOT NULL,
  data_type text NOT NULL CHECK (data_type IN ('text','textarea','email','phone','number','currency','date','datetime','boolean','picklist','multi_picklist','url')),
  storage text NOT NULL DEFAULT 'custom' CHECK (storage IN ('standard','custom')),
  standard_column text,
  help_text text,
  placeholder text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_value jsonb,
  required boolean NOT NULL DEFAULT false,
  searchable boolean NOT NULL DEFAULT false,
  unique_value boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, field_key),
  UNIQUE (organization_id, id),
  CHECK ((storage='standard' AND standard_column IS NOT NULL) OR storage='custom')
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_type_id uuid,
  name text NOT NULL,
  sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','archived')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, record_type_id) REFERENCES tenant.crm_lead_record_types(organization_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_assignment_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  sequence integer NOT NULL DEFAULT 100,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode text NOT NULL CHECK (mode IN ('fixed','round_robin','territory')),
  assignee_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  member_user_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  territory_id uuid REFERENCES tenant.crm_territories(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,name),
  UNIQUE (organization_id,id),
  CHECK ((mode='fixed' AND assignee_user_id IS NOT NULL) OR (mode='round_robin' AND cardinality(member_user_ids)>0) OR mode='territory')
);

CREATE TABLE IF NOT EXISTS tenant.crm_lead_assignment_state (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  policy_id uuid NOT NULL,
  next_index integer NOT NULL DEFAULT 0 CHECK (next_index>=0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,policy_id),
  FOREIGN KEY (organization_id,policy_id) REFERENCES tenant.crm_lead_assignment_policies(organization_id,id) ON DELETE CASCADE
);

ALTER TABLE tenant.crm_leads ADD COLUMN IF NOT EXISTS record_type_id uuid;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='tenant.crm_leads'::regclass AND conname='crm_leads_record_type_org_fkey') THEN
  ALTER TABLE tenant.crm_leads ADD CONSTRAINT crm_leads_record_type_org_fkey FOREIGN KEY (organization_id,record_type_id) REFERENCES tenant.crm_lead_record_types(organization_id,id) ON DELETE SET NULL NOT VALID;
 END IF;
END $$;
ALTER TABLE tenant.crm_leads VALIDATE CONSTRAINT crm_leads_record_type_org_fkey;

INSERT INTO tenant.crm_lead_record_types(organization_id,key,name,description,is_default,created_by,updated_by)
SELECT id,'standard','Standard lead','Default governed lead layout.',true,created_by,created_by FROM public.organizations
ON CONFLICT (organization_id,key) DO UPDATE SET is_default=true,updated_at=now();

WITH fields(field_key,label,data_type,storage,standard_column,required,searchable) AS (VALUES
 ('first_name','First name','text','standard','first_name',true,true),
 ('last_name','Last name','text','standard','last_name',false,true),
 ('email','Work email','email','standard','email',false,true),
 ('mobile','Mobile','phone','standard','mobile',false,true),
 ('company_name','Company','text','standard','company_name',false,true),
 ('job_title','Job title','text','standard','job_title',false,true),
 ('industry','Industry','text','standard','industry',false,true),
 ('website','Website','url','standard','website',false,false),
 ('estimated_value','Estimated value','currency','standard','estimated_value',false,false),
 ('product_interest','Product interest','text','standard','product_interest',false,true),
 ('next_follow_up_at','Next follow-up','datetime','standard','next_follow_up_at',false,false)
)
INSERT INTO tenant.crm_lead_field_definitions(organization_id,field_key,label,data_type,storage,standard_column,required,searchable,created_by,updated_by)
SELECT o.id,f.field_key,f.label,f.data_type,f.storage,f.standard_column,f.required,f.searchable,o.created_by,o.created_by FROM public.organizations o CROSS JOIN fields f
ON CONFLICT (organization_id,field_key) DO NOTHING;

INSERT INTO tenant.crm_lead_layouts(organization_id,record_type_id,name,sections,created_by,updated_by)
SELECT rt.organization_id,rt.id,'Standard lead layout',
 '[{"key":"identity","label":"Lead identity","fields":["first_name","last_name","company_name","job_title"]},{"key":"contact","label":"Contact","fields":["email","mobile","website"]},{"key":"qualification","label":"Qualification","fields":["industry","estimated_value","product_interest","next_follow_up_at"]}]'::jsonb,
 rt.created_by,rt.updated_by FROM tenant.crm_lead_record_types rt WHERE rt.key='standard'
ON CONFLICT (organization_id,name) DO NOTHING;

ALTER TABLE tenant.crm_lead_record_types ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_record_types FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_field_definitions ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_field_definitions FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_layouts ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_layouts FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignment_policies ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_assignment_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant.crm_lead_assignment_state ENABLE ROW LEVEL SECURITY; ALTER TABLE tenant.crm_lead_assignment_state FORCE ROW LEVEL SECURITY;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['crm_lead_record_types','crm_lead_field_definitions','crm_lead_layouts','crm_lead_assignment_policies','crm_lead_assignment_state'] LOOP
 EXECUTE format('DROP POLICY IF EXISTS tenant_organization_isolation ON tenant.%I',t);
 EXECUTE format('CREATE POLICY tenant_organization_isolation ON tenant.%I USING (organization_id=current_setting(''app.current_organization_id'',true)::uuid) WITH CHECK (organization_id=current_setting(''app.current_organization_id'',true)::uuid)',t);
END LOOP; END $$;
COMMIT;
