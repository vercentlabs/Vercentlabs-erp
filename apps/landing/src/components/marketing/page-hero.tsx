import type { ReactNode } from "react";

import PageContainer from "@/components/layout/page-container";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

export default function PageHero({
  eyebrow,
  title,
  description,
  actions,
}: PageHeroProps) {
  return (
    <section className="page-hero">
      <PageContainer width="wide">
        <RevealOnScroll>
          <div className="page-hero__grid">
            <p className="os-eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <div>
              <p>{description}</p>
              {actions ? (
                <div className="page-hero__actions">{actions}</div>
              ) : null}
            </div>
          </div>
        </RevealOnScroll>
      </PageContainer>
    </section>
  );
}
