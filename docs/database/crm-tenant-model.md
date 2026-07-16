# CRM Tenant Model

All CRM tables live in the `tenant` schema and carry `organization_id`. Row Level Security is enabled and forced on every CRM table. Request transactions set the organisation context before reading or mutating tenant records. CRM conversion reuses `tenant.business_parties`, `tenant.contacts`, items, price lists and currencies from the Business Data Foundation instead of creating duplicate customer masters.
