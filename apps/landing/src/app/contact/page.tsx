import { createPageMetadata } from "@/lib/metadata";
import { Mail, MapPin, MessageSquare } from "lucide-react";

import LeadForm from "@/components/forms/lead-form";
import PageContainer from "@/components/layout/page-container";
import MarketingShell from "@/components/marketing/marketing-shell";
import PageHero from "@/components/marketing/page-hero";
import { landingConfig } from "@/lib/landing-config";

export const metadata = createPageMetadata({
  title: "Book a VercentLabs ERP Demo",
  description:
    "Book a personalised VercentLabs ERP demo based on your modules, workflows, locations and current systems.",
  path: "/contact",
});

export default function ContactPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Contact"
        title="Start with the business problem, not a generic software demonstration."
        description="Share the current systems, operating process, organisation context and the outcome you are trying to achieve."
      />

      <section className="bg-slate-50 py-9 sm:py-16">
        <PageContainer>
          <div className="grid gap-5 sm:gap-8 lg:grid-cols-[0.72fr_1.28fr]">
            <div className="space-y-4">
              <ContactCard
                icon={Mail}
                title="Email"
                description={landingConfig.contactEmail}
              />

              <ContactCard
                icon={MapPin}
                title="Operating context"
                description="VercentLabs LLP is building from India for organisations that need connected enterprise operations."
              />

              <ContactCard
                icon={MessageSquare}
                title="Useful enquiry"
                description="Include current systems, process owners, pain points, users, locations and implementation timing."
              />
            </div>

            <LeadForm mode="contact" />
          </div>
        </PageContainer>
      </section>
    </MarketingShell>
  );
}

type ContactCardProps = {
  icon: typeof Mail;
  title: string;
  description: string;
};

function ContactCard({ icon: Icon, title, description }: ContactCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 sm:rounded-2xl sm:p-5">
      <Icon aria-hidden="true" className="h-6 w-6 text-indigo-600" />

      <h2 className="font-display mt-4 text-lg font-extrabold text-slate-950">
        {title}
      </h2>

      <p className="mt-2 text-sm leading-7 text-slate-600">{description}</p>
    </article>
  );
}
