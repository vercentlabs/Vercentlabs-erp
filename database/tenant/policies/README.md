# Tenant Policies

Tenant tables use PostgreSQL Row Level Security with a transaction-local
organisation identifier. Application code must also enforce company, branch and
permission scopes.
