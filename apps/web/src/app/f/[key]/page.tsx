import { notFound } from "next/navigation";
import { getPublicCaptureForm } from "@vercentlabs/api/crm";

import { withIngressClient } from "@/core/db";
import { HostedCaptureForm } from "@/features/crm/capture-forms/components/HostedCaptureForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contact us", robots: { index: false, follow: false } };

// A web form's own page (CRM plan 3.2): what a CRM web form asks for, shown to the public at /f/{key}, and embeddable in the
// organization's website as an iframe. The form key is the only credential; an unknown or switched-off form is not found.
export default async function HostedFormPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const form = await withIngressClient((client) => getPublicCaptureForm(client, key));
  if (!form) notFound();
  return (
    <main className="min-h-screen bg-surface-muted px-4 py-8">
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-text-muted">{form.organizationName}</p>
          <h1 className="text-xl font-semibold">{form.name}</h1>
        </div>
        <HostedCaptureForm formKey={key} form={form} />
      </div>
    </main>
  );
}
