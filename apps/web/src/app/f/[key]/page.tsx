import { notFound } from "next/navigation";
import { getPublicCaptureForm } from "@vercentlabs/api/crm";

import { ingressTransaction } from "@/core/db";
import { HostedCaptureForm } from "@/features/crm/capture-forms/components/HostedCaptureForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact us", robots: { index: false, follow: false } };

// A web form's own page (CRM plan 3.2): what a CRM web form asks for, shown to the public at /f/{key}, and embeddable in the
// organization's website as an iframe. The form key is the only credential; an unknown or switched-off form (or CRM switched off) is not found.
export default async function HostedFormPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const form = await ingressTransaction((client) => getPublicCaptureForm(client, key));
  if (!form) notFound();
  const initial = (form.organizationName ?? "").trim().charAt(0).toUpperCase() || "•";
  return (
    // Phone: the form fills the screen edge to edge; from a tablet up it sits as a card a little below the top.
    <main className="min-h-screen bg-surface-muted sm:px-6 sm:py-12 lg:py-16 max-lg:pb-[calc(3rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 bg-surface px-5 py-6 sm:rounded-[var(--radius-card)] sm:border sm:border-border sm:p-8 sm:shadow-sm">
        <header className="flex flex-col gap-4 border-b border-border pb-5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-[var(--radius-control)] bg-brand text-sm font-semibold text-text-inverse" aria-hidden="true">{initial}</span>
            <span className="text-sm font-medium text-text-secondary">{form.organizationName}</span>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-text">{form.name}</h1>
            <p className="text-sm text-text-secondary">Leave your details and the team will get back to you.</p>
          </div>
        </header>
        <HostedCaptureForm formKey={key} form={form} />
      </div>
    </main>
  );
}
