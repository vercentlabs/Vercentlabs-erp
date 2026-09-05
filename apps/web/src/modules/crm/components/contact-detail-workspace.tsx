"use client";

import { Record360Archetype } from "@/shared/design";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import ContactFormDrawer from "@/modules/crm/components/contact-form-drawer";
import { requestJson } from "@/shared/http/client-request";

type Contact = Record<string, unknown> & {
  relationships?: { opportunities?: number; activities?: number };
};

function display(value: unknown, fallback = "Not added") {
  return value == null || value === "" ? fallback : String(value);
}

function date(value: unknown) {
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export default function ContactDetailWorkspace({ contact, canManage }: { contact: Contact; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const archiveDialog = useRef<HTMLDialogElement>(null);
  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ");

  useEffect(() => {
    const dialog = archiveDialog.current;
    if (!dialog) return;
    if (confirming && !dialog.open) dialog.showModal();
    if (!confirming && dialog.open) dialog.close();
  }, [confirming]);

  async function archiveContact() {
    setPending(true);
    setMessage("");
    const result = await requestJson(`/api/crm/contacts/${String(contact.id)}`, { method: "DELETE" });
    if (!result.ok) {
      setMessage(result.message || "The contact could not be archived.");
      setPending(false);
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <Record360Archetype className="crm-contact-detail">
      <Link className="crm-record-back" href="/crm/contacts">← Contacts</Link>
      <header className="crm-contact-detail-header">
        <div>
          <p className="eyebrow">CRM · Contact</p>
          <h1>{fullName}</h1>
          <p>{[contact.designation, contact.accountName].filter(Boolean).join(" · ") || "Business contact"}</p>
        </div>
        <div className="crm-contact-detail-actions">
          <span className={`status-badge ${contact.status === "active" ? "success" : "neutral"}`}>{contact.status === "active" ? "Active" : "Archived"}</span>
          {canManage && contact.status === "active" ? (
            <><button className="secondary-button" type="button" onClick={() => setEditing(true)}>Edit</button><button className="danger-button" type="button" onClick={() => setConfirming(true)}>Archive</button></>
          ) : null}
        </div>
      </header>

      {message ? <div className="notice error" role="alert">{message}</div> : null}

      <main className="crm-contact-detail-grid">
        <section className="panel crm-contact-detail-section">
          <div className="crm-contact-section-heading"><p className="eyebrow">Contact</p><h2>Reachability</h2></div>
          <dl className="crm-contact-facts">
            <div><dt>Work email</dt><dd>{contact.email ? <a href={`mailto:${String(contact.email)}`}>{String(contact.email)}</a> : "Not added"}</dd></div>
            <div><dt>Mobile</dt><dd>{contact.mobile ? <a href={`tel:${String(contact.mobile)}`}>{String(contact.mobile)}</a> : "Not added"}</dd></div>
            <div><dt>Business phone</dt><dd>{contact.phone ? <a href={`tel:${String(contact.phone)}`}>{String(contact.phone)}</a> : "Not added"}</dd></div>
          </dl>
        </section>

        <section className="panel crm-contact-detail-section">
          <div className="crm-contact-section-heading"><p className="eyebrow">Business</p><h2>Company context</h2></div>
          <dl className="crm-contact-facts">
            <div><dt>Job title</dt><dd>{display(contact.designation)}</dd></div>
            <div><dt>Company</dt><dd>{contact.accountId ? <Link href={`/crm/accounts/${String(contact.accountId)}`}>{String(contact.accountName)} <span aria-hidden="true">→</span></Link> : "Standalone contact"}{contact.accountStatus === "inactive" ? <small>Archived account</small> : null}</dd></div>
            <div><dt>Account location</dt><dd>{[contact.accountCity, contact.accountState, contact.accountCountryCode].filter(Boolean).join(", ") || "Not available"}</dd></div>
            <div><dt>Primary contact</dt><dd>{contact.isPrimary ? "Yes" : "No"}</dd></div>
          </dl>
        </section>

        <section className="panel crm-contact-detail-section">
          <div className="crm-contact-section-heading"><p className="eyebrow">Governance</p><h2>Record information</h2></div>
          <dl className="crm-contact-facts crm-contact-facts-compact">
            <div><dt>Status</dt><dd>{contact.status === "active" ? "Active" : "Archived"}</dd></div>
            <div><dt>Created</dt><dd>{date(contact.createdAt)}</dd></div>
            <div><dt>Updated</dt><dd>{date(contact.updatedAt)}</dd></div>
            {contact.archivedAt ? <div><dt>Archived</dt><dd>{date(contact.archivedAt)}</dd></div> : null}
          </dl>
        </section>

        <section className="panel crm-contact-detail-section">
          <div className="crm-contact-section-heading"><p className="eyebrow">Related CRM information</p><h2>Relationships</h2></div>
          <div className="crm-contact-related">
            {contact.accountId ? <Link href={`/crm/accounts/${String(contact.accountId)}`}><span>Account</span><strong>{String(contact.accountName)}</strong><span aria-hidden="true">→</span></Link> : null}
            <Link href="/crm/opportunities"><span>Opportunities</span><strong>{Number(contact.relationships?.opportunities || 0)}</strong><span aria-hidden="true">→</span></Link>
            <Link href="/crm/activities"><span>Activities</span><strong>{Number(contact.relationships?.activities || 0)}</strong><span aria-hidden="true">→</span></Link>
          </div>
        </section>
      </main>

      {editing ? (
        <ContactFormDrawer
          contact={contact}
          closeHref={`/crm/contacts/${String(contact.id)}`}
          onDismiss={() => setEditing(false)}
        />
      ) : null}
      <dialog
        ref={archiveDialog}
        className="crm-contact-archive-dialog"
        aria-labelledby="archive-contact-title"
        onCancel={() => setConfirming(false)}
        onClose={() => setConfirming(false)}
      >
        <h2 id="archive-contact-title">Archive {fullName}?</h2>
        <p>This contact will be removed from active CRM workspaces. Historical relationships and activity will remain available.</p>
        {message ? <p className="field-error" role="alert">{message}</p> : null}
        <div><button className="secondary-button" type="button" disabled={pending} onClick={() => setConfirming(false)}>Cancel</button><button className="danger-button" type="button" disabled={pending} onClick={() => void archiveContact()}>{pending ? "Archiving…" : "Archive contact"}</button></div>
      </dialog>
    </Record360Archetype>
  );
}
