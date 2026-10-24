"use client";

// The tab bars of the Sales pages that share one sidebar item (Sales report, navigation N1, N2 and N4): each tab is its own address, so
// old links and bookmarks keep opening the right page.
import { LinkTabs } from "@/shared/ui/RouteTabs";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export function NotesTabs({ current }: { current: "credit" | "debit" }) {
  return <LinkTabs label="Credit and debit notes" current={current}
    tabs={[{ id: "credit", label: "Credit notes", href: "/sales/credit-notes" }, { id: "debit", label: "Debit notes", href: "/sales/debit-notes" }]} />;
}

// E-invoices & E-way Bills: what still needs an IRN or an e-way bill (people with GST access), and the e-way bills made.
export function EDocumentsTabs({ current }: { current: "todo" | "eway" }) {
  const workspace = useWorkspaceContext();
  const gst = workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("gst.view");
  return <LinkTabs label="E-invoices and e-way bills" current={current} tabs={[
    ...(gst ? [{ id: "todo", label: "To do", href: "/sales/gst-documents" }] : []),
    { id: "eway", label: "E-way bills made", href: "/sales/eway-bills" },
  ]} />;
}

// Prices & Offers: everything that decides a price, in one place.
export function PricesTabs({ current }: { current: "lists" | "contracts" | "schemes" | "coupons" | "discounts" }) {
  return <LinkTabs label="Prices and offers" current={current} tabs={[
    { id: "lists", label: "Price lists", href: "/sales/price-lists" },
    { id: "contracts", label: "Customer rates", href: "/sales/rate-contracts" },
    { id: "schemes", label: "Schemes & offers", href: "/sales/pricing-rules" },
    { id: "coupons", label: "Coupons", href: "/sales/coupons" },
    { id: "discounts", label: "Discount limits", href: "/sales/settings/discounts" },
  ]} />;
}

// Payments Received: the payments, and the cheque register.
export function PaymentsTabs({ current }: { current: "payments" | "cheques" }) {
  return <LinkTabs label="Payments received" current={current} tabs={[
    { id: "payments", label: "Payments", href: "/sales/payments" },
    { id: "cheques", label: "Cheques", href: "/sales/payments/cheques" },
  ]} />;
}
