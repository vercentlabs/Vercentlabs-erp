import Link from "next/link";
import { requireWorkspace } from "@/lib/auth";
import { query } from "@/lib/db";

export const metadata = { title: "Search" };
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireWorkspace();
  const { q = "" } = await searchParams;
  const term = q.trim();
  const results =
    term.length >= 2
      ? await query<{
          type: string;
          id: string;
          title: string;
          subtitle: string;
          href: string;
        }>(
          `
    SELECT 'Company' AS type,id,name AS title,code AS subtitle,'/settings/companies' AS href FROM companies WHERE organization_id=$1 AND (name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')
    UNION ALL
    SELECT 'Branch',id,name,code,'/settings/branches' FROM branches WHERE organization_id=$1 AND (name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')
    UNION ALL
    SELECT 'Department',id,name,code,'/settings/departments' FROM departments WHERE organization_id=$1 AND (name ILIKE '%'||$2||'%' OR code ILIKE '%'||$2||'%')
    UNION ALL
    SELECT 'User',u.id,u.full_name,u.email,'/settings/users' FROM users u JOIN organization_memberships m ON m.user_id=u.id WHERE m.organization_id=$1 AND (u.full_name ILIKE '%'||$2||'%' OR u.email ILIKE '%'||$2||'%')
    LIMIT 100
  `,
          [session.organizationId, term],
        )
      : [];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Global search</p>
          <h1>{term ? `Results for “${term}”` : "Search the workspace"}</h1>
          <p>
            Search across organisation structure and user access. Business
            records join this index as modules are implemented.
          </p>
        </div>
      </section>
      {term.length < 2 ? (
        <section className="panel">
          <p>Enter at least two characters in the search field above.</p>
        </section>
      ) : (
        <section className="search-results">
          {results.map((result) => (
            <Link
              className="search-result"
              href={result.href}
              key={`${result.type}-${result.id}`}
            >
              <span>{result.type}</span>
              <strong>{result.title}</strong>
              <small>{result.subtitle}</small>
            </Link>
          ))}
          {!results.length ? (
            <div className="empty-state">
              <strong>No matching records</strong>
              <p>Try a company, branch, department, user name or email.</p>
            </div>
          ) : null}
        </section>
      )}
    </>
  );
}
