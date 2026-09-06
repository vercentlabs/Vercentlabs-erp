"use client";

import { ActionButton, ErrorState } from "@/shared/design";

export default function ContactsError({ reset }: { reset: () => void }) {
  return (
    <section className="panel crm-contact-route-error">
      <p className="eyebrow">CRM · Contacts</p>
      <ErrorState
        title="We couldn’t load contacts"
        description="Your search and filters are unchanged. Try loading the workspace again."
        action={
          <ActionButton tone="primary" type="button" onClick={reset}>
            Try again
          </ActionButton>
        }
      />
    </section>
  );
}
