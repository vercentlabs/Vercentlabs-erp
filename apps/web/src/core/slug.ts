import type { PoolClient } from "pg";

export function baseSlug(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "organization"
  );
}

export async function uniqueOrganizationSlug(client: PoolClient, name: string) {
  const base = baseSlug(name);
  for (let index = 0; index < 50; index += 1) {
    const candidate = index === 0 ? base : `${base}-${index + 1}`;
    const result = await client.query(
      "SELECT 1 FROM organizations WHERE slug = $1",
      [candidate],
    );
    if (result.rowCount === 0) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
