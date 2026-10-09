import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

// Redirects an old or alias address to the page that owns it, keeping the query (filters, drill-downs, bookmarks) and setting or
// dropping the given parameters (undefined drops one).
export function redirectWithQuery(path: string, searchParams: SearchParams, set: Record<string, string | undefined> = {}): never {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key in set) continue;
    for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) query.append(key, item);
  }
  for (const [key, value] of Object.entries(set)) if (value !== undefined) query.set(key, value);
  const text = query.toString();
  redirect(text ? `${path}?${text}` : path);
}
