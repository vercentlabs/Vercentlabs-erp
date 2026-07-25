import { ArrowDown, ArrowRight, Check, ShieldCheck } from "lucide-react";
import Link from "next/link";

import OperatingSystemDemo from "@/components/home/operating-system-demo";
import PageContainer from "@/components/layout/page-container";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";

const proofMetrics = [
  { label: "Released module", value: "1" },
  { label: "Roadmap modules", value: "11" },
  { label: "Control layer", value: "Shared" },
] as const;

export default function HeroSection() {
  return (
    <section className="os-hero" aria-labelledby="os-hero-title">
      <PageContainer width="wide">
        <div className="os-hero__status-row">
          <span>ERP / customer operations</span>
          <span>Built in India</span>
          <span>Release 01 / CRM</span>
        </div>

        <RevealOnScroll>
          <div className="os-hero__headline-grid">
            <div>
              <p className="os-eyebrow">Released CRM early access</p>
              <h1 id="os-hero-title">
                <span>Run the work.</span>
                <span>Keep the truth.</span>
              </h1>
            </div>

            <div className="os-hero__intro">
              <p>
                VercentLabs ERP gives customer work one accountable operating
                record—from first signal to governed decision—without hiding
                roadmap software behind marketing language.
              </p>
              <div className="os-hero__actions">
                <Link href="/contact" className="button-primary">
                  Book a working-session demo
                  <ArrowRight aria-hidden="true" />
                </Link>
                <Link href="/product" className="button-secondary">
                  Inspect released scope
                </Link>
              </div>
              <p className="os-hero__assurance">
                <ShieldCheck aria-hidden="true" /> Roles, permissions, approvals
                and audit history are part of the operating model.
              </p>
            </div>
          </div>
        </RevealOnScroll>

        <RevealOnScroll delay={100}>
          <OperatingSystemDemo />
        </RevealOnScroll>

        <div className="os-hero__footer">
          <div className="os-hero__metrics" aria-label="Release scope">
            {proofMetrics.map((item) => (
              <div key={item.label}>
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
          <a href="#operating-model" className="os-scroll-cue">
            Explore the operating model
            <ArrowDown aria-hidden="true" />
          </a>
        </div>
      </PageContainer>

      <div className="os-hero__ledger" aria-label="Product principles">
        {[
          "Explicit ownership",
          "Controlled handoffs",
          "Visible context",
          "Recorded decisions",
        ].map((item) => (
          <span key={item}>
            <Check aria-hidden="true" /> {item}
          </span>
        ))}
      </div>
    </section>
  );
}
