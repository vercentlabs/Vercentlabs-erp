"use client";

export default function ContactsError({ reset }: { reset: () => void }) {
  return (
    <section className="panel crm-contact-route-error" role="alert">
      <p className="eyebrow">CRM · Contacts</p>
      <h1>We couldn’t load contacts</h1>
      <p>Your search and filters are unchanged. Try loading the workspace again.</p>
      <button className="primary-button" type="button" onClick={reset}>Try again</button>
    </section>
  );
}
