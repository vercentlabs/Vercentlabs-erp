"use client";

// Sales Setup: every Sales configuration page on one screen, grouped under
// its heading, in the main content area. Sales' own pages come from the
// navigation registry (module-navigation-registry.ts, parent "sales-setup"),
// so each card opens a real route and only pages the person may open are
// shown. Configuration Sales shares with the rest of the platform (taxes,
// document numbering, imports) is linked, never copied: those cards open the
// shared page.
import Link from "next/link";
import { ChevronRight, Database, FileDigit, Percent } from "lucide-react";
import { PageHeader, PermissionState } from "@vercentlabs/design-system";

import { getModuleNavigation } from "@/shell/navigation/module-navigation-registry";
import { isItemPermitted, workspaceChildren, type NavViewer } from "@/shell/navigation/navigation-resolution";
import type { NavIcon, SecondaryNavItem } from "@/shell/navigation/navigation-types";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

const SETTINGS_WORKSPACE = "sales-setup";
type Card = { id: string; label: string; route: string; description?: string; shared?: boolean };

// Shared configuration Sales uses. Each entry is checked against the permission of the page it opens.
const SHARED: Array<{ id: string; label: string; description: string; icon: NavIcon; cards: Array<SecondaryNavItem & { shared: true }> }> = [
  {
    id: "tax", label: "Tax", description: "Sales documents calculate tax with the shared tax engine.", icon: Percent,
    cards: [{ id: "taxes", label: "Taxes", route: "/settings/taxes", status: "AVAILABLE", requiredPermission: "tax.view", shared: true,
      description: "Tax categories, rates, components and GST registrations. Opens the shared Tax Settings." }],
  },
  {
    id: "documents", label: "Documents", description: "Quotation, order, delivery, invoice, return and credit note numbers.", icon: FileDigit,
    cards: [{ id: "numbering", label: "Document Numbering", route: "/settings/numbering", status: "AVAILABLE", requiredPermission: "numbering.manage", shared: true,
      description: "Prefixes and sequences for every Sales document. Opens the shared Numbering settings." }],
  },
  {
    id: "data", label: "Data", description: "Bring Sales master data in from a file.", icon: Database,
    cards: [
      { id: "import-customers", label: "Import Customers", route: "/sales/customers/import", status: "AVAILABLE", requiredPermission: "sales.customers.import", shared: true,
        description: "Create or update customers from a CSV file." },
      { id: "import-products", label: "Import Products & Services", route: "/sales/products/import", status: "AVAILABLE", requiredPermission: "products.import", shared: true,
        description: "Create or update catalog items from a CSV file." },
      { id: "price-lists", label: "Import Prices", route: "/sales/price-lists", status: "AVAILABLE", requiredPermission: "sales.price_lists.import", shared: true,
        description: "Open a price list to import or export its prices." },
    ],
  },
];

function CardGrid({ label, items }: { label: string; items: Card[] }) {
  return (
    <ul aria-label={`${label} settings`} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.id}>
          <Link href={item.route}
            className="group flex h-full items-start gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none">
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-sm font-semibold text-text">{item.label}</span>
              {item.description ? <span className="text-sm text-text-secondary">{item.description}</span> : null}
            </span>
            <ChevronRight aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted group-hover:text-text" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Section({ id, label, description, icon: Icon, items }: { id: string; label: string; description: string; icon: NavIcon; items: Card[] }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-brand-soft text-brand">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <div className="flex flex-col">
          <h2 id={`${id}-heading`} className="text-base font-semibold text-text">{label}</h2>
          <p className="text-sm text-text-secondary">{description}</p>
        </div>
      </div>
      <CardGrid label={label} items={items} />
    </section>
  );
}

export function SalesSettingsScreen() {
  const workspace = useWorkspaceContext();
  const sales = getModuleNavigation("sales");
  if (!sales) return null;
  const viewer: NavViewer = { permissions: workspace.permissions, isOwner: workspace.roleSlugs.includes("organization_owner") };
  const destinations = workspaceChildren(sales, SETTINGS_WORKSPACE, viewer);
  const own = (sales.groups ?? [])
    .filter((group) => group.workspace === SETTINGS_WORKSPACE)
    .map((group) => ({ group, items: destinations.filter((item) => item.group === group.id) }))
    .filter((entry) => entry.items.length > 0);
  const shared = SHARED.map((entry) => ({ ...entry, cards: entry.cards.filter((card) => isItemPermitted(card, viewer)) })).filter((entry) => entry.cards.length > 0);
  if (own.length === 0 && shared.length === 0) return <PermissionState title="You do not have access to Sales Setup" />;
  return (
    <div className="flex flex-1 flex-col gap-8">
      <PageHeader title="Sales Setup" description="Quotation and order rules, fulfillment, and the shared settings Sales documents use. Discounts and payment terms have their own pages under Configuration." />
      {own.map(({ group, items }) => <Section key={group.id} id={group.id} label={group.label} description={group.description} icon={group.icon} items={items} />)}
      {shared.map((entry) => <Section key={entry.id} id={entry.id} label={entry.label} description={entry.description} icon={entry.icon} items={entry.cards} />)}
    </div>
  );
}

