// Where each app opens (its main screen), and which app a path belongs to. The first app on someone's list is where they land after
// setup, after signing in (the last app they used) and after joining a team; the Get started / Welcome card shows on these screens.
export const APP_LANDING: Readonly<Record<string, string>> = {
  crm: "/crm/pipeline", sales: "/sales/quotations", "point-of-sale": "/pos/register", accounting: "/accounting/customer-invoices", procurement: "/procurement/purchase-orders",
  stock: "/inventory/stock", manufacturing: "/manufacturing/orders", projects: "/projects", assets: "/assets/register", quality: "/quality/incoming", support: "/support",
  "hr-payroll": "/hr/employees",
};
const PREFIXES: ReadonlyArray<readonly [string, string]> = [["/crm", "crm"], ["/sales", "sales"], ["/pos", "point-of-sale"], ["/accounting", "accounting"],
  ["/procurement", "procurement"], ["/inventory", "stock"], ["/manufacturing", "manufacturing"], ["/projects", "projects"], ["/assets", "assets"], ["/quality", "quality"],
  ["/support", "support"], ["/hr", "hr-payroll"]];
export function moduleKeyForPath(pathname: string): string | null {
  return PREFIXES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? null;
}
export const landingFor = (moduleKey: string | null | undefined) => (moduleKey && APP_LANDING[moduleKey]) || "/";
