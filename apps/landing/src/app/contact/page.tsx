import LeadForm from "@/components/forms/lead-form";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import {
  OperatorBand,
  OperatorNote,
} from "@/components/marketing/operator-page";
import { createPageMetadata } from "@/lib/metadata";
import { siteConfig } from "@/lib/site-config";

export const metadata = createPageMetadata({
  title: "Contact Vercentlabs",
  description:
    "Discuss a CRM pilot, ERP roadmap problem, implementation partnership or Vercentlabs product question.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Start a grounded conversation"
        title="Tell us what the operation is trying to control."
        description="Share the current systems, users, handoffs, data ownership and outcome you need. A useful conversation begins with the operating problem—not a generic software demo."
      />

      <OperatorBand
        index="01"
        eyebrow="Contact"
        title="One form. Enough context to prepare properly."
        description="Use this for product evaluation, CRM early access, roadmap discovery, implementation or partnership discussions."
        tone="white"
      >
        <div className="operator-form-layout">
          <div className="operator-form-layout__context">
            <h2>What helps us respond well.</h2>
            <p>
              Describe the business structure, current workflow, users involved,
              tools being replaced, control concerns and desired timeline.
            </p>
            <dl className="operator-form-layout__meta">
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
                </dd>
              </div>
              <div>
                <dt>Headquarters</dt>
                <dd>India</dd>
              </div>
              <div>
                <dt>Best fit</dt>
                <dd>CRM pilot · ERP roadmap · implementation</dd>
              </div>
              <div>
                <dt>Response</dt>
                <dd>Business-day review</dd>
              </div>
            </dl>
          </div>
          <div>
            <LeadForm mode="contact" />
          </div>
        </div>
        <OperatorNote label="No theatre">
          <p>
            We do not use fake customer logos, invented metrics or generic
            discovery scripts. The conversation will stay within released scope
            and clearly labelled roadmap direction.
          </p>
        </OperatorNote>
      </OperatorBand>
    </MarketingShell>
  );
}
