// Checks shared by the web and worker deployables at startup and in
// readiness: the connection really is a restricted runtime role, and the
// database carries every expand migration this build expects.
import { EXPECTED_MIGRATIONS } from "./migration-manifest.js";

export class RuntimeCheckError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RuntimeCheckError";
    this.code = code;
  }
}

// Production always enforces; elsewhere ENFORCE_RESTRICTED_DB_ROLE=true opts in.
export function restrictedRoleRequired(environment = process.env) {
  return environment.NODE_ENV === "production" || environment.ENFORCE_RESTRICTED_DB_ROLE === "true";
}

/** Throws unless the connection's role is LOGIN-only, cannot bypass RLS, and owns nothing. */
export async function verifyRestrictedRuntimeRole(queryable, label = "DATABASE_URL") {
  const { rows } = await queryable.query(`
    SELECT
      current_user AS role_name,
      role.rolsuper AS is_superuser,
      role.rolbypassrls AS bypasses_rls,
      role.rolinherit AS inherits_roles,
      role.rolcreatedb AS can_create_database,
      role.rolcreaterole AS can_create_roles,
      role.rolreplication AS can_replicate,
      EXISTS (
        SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE relation.relowner = role.oid AND namespace.nspname IN ('public', 'tenant')
      ) AS owns_relations,
      EXISTS (
        SELECT 1 FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
         WHERE routine.proowner = role.oid AND namespace.nspname IN ('public', 'tenant')
      ) AS owns_functions,
      EXISTS (
        SELECT 1 FROM pg_namespace namespace
         WHERE namespace.nspname IN ('public', 'tenant') AND has_schema_privilege(current_user, namespace.oid, 'CREATE')
      ) AS can_create_schema_objects,
      EXISTS (
        SELECT 1 FROM pg_auth_members membership JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
         WHERE membership.member = role.oid
           AND (granted_role.rolsuper OR granted_role.rolbypassrls OR granted_role.rolcreatedb OR granted_role.rolcreaterole OR granted_role.rolreplication)
      ) AS has_dangerous_membership
    FROM pg_roles role
    WHERE role.rolname = current_user
  `);
  const role = rows[0];
  const failures = !role
    ? ["unknown role"]
    : Object.entries({
        superuser: role.is_superuser,
        "bypasses RLS": role.bypasses_rls,
        "inherits roles": role.inherits_roles,
        "can create databases": role.can_create_database,
        "can create roles": role.can_create_roles,
        "can replicate": role.can_replicate,
        "owns relations": role.owns_relations,
        "owns functions": role.owns_functions,
        "can create schema objects": role.can_create_schema_objects,
        "holds a privileged role membership": role.has_dangerous_membership,
      })
        .filter(([, bad]) => bad)
        .map(([reason]) => reason);
  if (failures.length) {
    throw new RuntimeCheckError(`${label} must use a restricted runtime role (${role?.role_name ?? "?"}: ${failures.join(", ")}).`, "DATABASE_ROLE_NOT_RESTRICTED");
  }
  return role.role_name;
}

/**
 * Compares applied expand migrations with the ones this build was compiled
 * against. Missing = the database is behind this code (not ready). Contract
 * migrations are never required for readiness.
 */
export async function readMigrationStatus(queryable, expected = EXPECTED_MIGRATIONS) {
  const { rows } = await queryable.query(`SELECT scope, filename FROM public.schema_migrations WHERE filename NOT LIKE 'contracts/%'`);
  const applied = new Set(rows.map((row) => `${row.scope}/${row.filename}`));
  const missing = [];
  for (const scope of ["platform", "tenant"]) {
    for (const filename of expected[scope] ?? []) if (!applied.has(`${scope}/${filename}`)) missing.push(`${scope}/${filename}`);
  }
  return { ready: missing.length === 0, missing, latest: { platform: expected.platform?.at(-1) ?? null, tenant: expected.tenant?.at(-1) ?? null } };
}
