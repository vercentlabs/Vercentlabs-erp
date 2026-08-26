export default function ContactsLoading() {
  return (
    <div className="crm-contacts-workspace" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading contacts</span>
      <div className="crm-contact-skeleton crm-contact-skeleton-heading" />
      <div className="panel crm-contacts-panel">
        <div className="crm-contact-skeleton crm-contact-skeleton-filters" />
        <div className="crm-contact-skeleton crm-contact-skeleton-list" />
      </div>
    </div>
  );
}
