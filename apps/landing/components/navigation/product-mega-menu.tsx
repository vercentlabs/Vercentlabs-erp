import Link from "next/link";
import { CTAS, PRIMARY_NAV } from "@vercentlabs/landing-content";

const productItem = PRIMARY_NAV.find((item) => item.label === "Product");
const productLinks = new Map(productItem?.children?.map((item) => [item.href, item]) ?? []);

const PRODUCT_GROUPS = [
  {
    label: "Core platform",
    accent: "#4338ca",
    links: [
      { href: "/product/platform", description: "Architecture, tenant controls and shared foundations." },
      { href: "/product/automation", description: "Rules, approvals and scheduled operational work." },
      { href: "/product/analytics", description: "Reports, dashboards and decision signals." },
    ],
  },
  {
    label: "Experience & trust",
    accent: "#087f6a",
    links: [
      { href: "/product/mobile", description: "Responsive and offline-ready business workflows." },
      { href: "/security", description: "Roles, permissions, sessions and auditability." },
      { href: "/product/integrations", description: "APIs, webhooks and connected systems." },
    ],
  },
  {
    label: "Adoption & operations",
    accent: "#a16207",
    links: [
      { href: "/implementation", description: "Rollout phases, migration and readiness guidance." },
      { href: "/solutions", description: "Operating problems mapped to system capabilities." },
      { href: "/workflows", description: "Cross-module process maps and handoffs." },
    ],
  },
] as const;

export function ProductMegaMenuContent() {
  return (
    <div className="flex h-full w-[min(60vw,860px)] flex-col xl:w-[min(76vw,860px)]">
      <div className="mb-5 grid shrink-0 grid-cols-[1fr_auto] items-end border-b border-(--color-border-strong) pb-4">
        <div>
          <p className="vl-kicker">Product system map</p>
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-(--color-text-secondary)">
            Explore the platform, the controls around it, and the paths used to put it into operation.
          </p>
        </div>
        <span className="tabular-data text-4xl font-semibold tracking-[-0.06em] text-(--color-text-primary)">09</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 overflow-y-auto border-l border-t border-(--color-border-default)">
        {PRODUCT_GROUPS.map((group, groupIndex) => (
          <section key={group.label} className="border-b border-r border-(--color-border-default) p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-[0.66rem] font-bold uppercase tracking-[0.13em] text-(--color-text-muted)">{group.label}</p>
              <span className="vl-index">{String(groupIndex + 1).padStart(2, "0")}</span>
            </div>
            <ul className="flex flex-col">
              {group.links.map((entry) => {
                const link = productLinks.get(entry.href);
                if (!link) return null;
                return (
                  <li key={entry.href}>
                    <Link
                      href={entry.href}
                      prefetch={false}
                      className="group grid grid-cols-[4px_1fr_auto] items-start gap-3 border-t border-(--color-border-subtle) py-3 first:border-t-0"
                    >
                      <span className="mt-1 h-8 w-1" style={{ backgroundColor: group.accent }} aria-hidden="true" />
                      <span>
                        <span className="block text-sm font-semibold text-(--color-text-primary) group-hover:text-(--color-text-brand)">{link.label}</span>
                        <span className="mt-0.5 block text-[0.7rem] leading-snug text-(--color-text-muted)">{entry.description}</span>
                      </span>
                      <span className="text-xs text-(--color-text-muted) transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-4 border-x border-b border-(--color-border-default) bg-(--color-bg-subtle) px-4 py-3">
        <Link href={productItem?.href ?? "/product"} prefetch={false} className="vl-editorial-link text-sm font-semibold text-(--color-text-brand)">
          See the product overview
        </Link>
        <Link href={CTAS.primary.href} prefetch={false} className="vl-editorial-link text-sm font-semibold text-(--color-text-secondary)">
          {CTAS.primary.label}
        </Link>
      </div>
    </div>
  );
}
