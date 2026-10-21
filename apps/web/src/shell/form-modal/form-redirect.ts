import "server-only";

import { redirect } from "next/navigation";

// An old create / edit address (a bookmark, a link from an email, a page reload) opens the page it belongs to — the list, or the record
// for an edit — and that page opens the form in its modal (OpenFormFromAddress).
// route / parent: the route templates, e.g. "crm/leads/[leadId]/edit" and "crm/leads/[leadId]" (a parent may carry a query, for a list that
// is a view of another page).
export function formRedirect(route: string, parent: string, params: Record<string, string | string[] | undefined>, search: Record<string, string | string[] | undefined>): never {
  const fill = (template: string) => "/" + template.split("/").map((segment) => {
    const name = /^\[\.{0,3}(.+)\]$/.exec(segment)?.[1];
    if (!name) return segment;
    const value = params[name];
    return encodeURIComponent(Array.isArray(value) ? value.join("/") : String(value ?? ""));
  }).join("/");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  const form = `${fill(route)}${query.size ? `?${query}` : ""}`;
  const [parentPath, parentQuery] = parent.split("?");
  redirect(`${fill(parentPath)}?${parentQuery ? `${parentQuery}&` : ""}form=${encodeURIComponent(form)}`);
}
