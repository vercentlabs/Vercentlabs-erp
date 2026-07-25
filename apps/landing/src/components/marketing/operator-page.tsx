import type { LucideIcon } from "lucide-react";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import PageContainer from "@/components/layout/page-container";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";

export type OperatorAction = { label: string; href: string };

export function OperatorBand({
  index,
  eyebrow,
  title,
  description,
  children,
  tone = "paper",
  id,
}: {
  index?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  tone?: "paper" | "white" | "ink" | "signal";
  id?: string;
}) {
  return (
    <section id={id} className={`operator-band operator-band--${tone}`}>
      <PageContainer width="wide">
        <RevealOnScroll>
          <div className="operator-band__heading">
            <div className="operator-band__label">
              {index ? <span>{index}</span> : null}
              {eyebrow ? <p>{eyebrow}</p> : null}
            </div>
            <h2>{title}</h2>
            {description ? <p>{description}</p> : <span aria-hidden="true" />}
          </div>
          {children ? (
            <div className="operator-band__body">{children}</div>
          ) : null}
        </RevealOnScroll>
      </PageContainer>
    </section>
  );
}

export function OperatorGrid({
  children,
  columns = 3,
  className = "",
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={`operator-grid operator-grid--${columns} ${className}`}>
      {children}
    </div>
  );
}

export function OperatorCard({
  index,
  icon: Icon,
  eyebrow,
  title,
  description,
  href,
  meta,
  status,
  children,
}: {
  index?: string;
  icon?: LucideIcon;
  eyebrow?: string;
  title: string;
  description?: string;
  href?: string;
  meta?: string;
  status?: "released" | "foundation" | "roadmap" | "neutral";
  children?: ReactNode;
}) {
  const content = (
    <>
      <div className="operator-card__topline">
        {index ? <span className="operator-card__index">{index}</span> : null}
        {Icon ? (
          <Icon aria-hidden="true" className="operator-card__icon" />
        ) : null}
        {status ? (
          <span className={`operator-status operator-status--${status}`}>
            {status}
          </span>
        ) : null}
      </div>
      {eyebrow ? <p className="operator-card__eyebrow">{eyebrow}</p> : null}
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {children}
      {meta ? <small>{meta}</small> : null}
      {href ? (
        <span className="operator-card__link">
          Open <ArrowRight aria-hidden="true" />
        </span>
      ) : null}
    </>
  );

  return href ? (
    <Link href={href} className="operator-card operator-card--link">
      {content}
    </Link>
  ) : (
    <article className="operator-card">{content}</article>
  );
}

export function OperatorList({
  items,
}: {
  items: readonly string[] | string[];
}) {
  return (
    <ul className="operator-list">
      {items.map((item) => (
        <li key={item}>
          <Check aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function OperatorSteps({
  items,
}: {
  items: readonly string[] | string[];
}) {
  return (
    <ol className="operator-steps">
      {items.map((item, index) => (
        <li key={item}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <p>{item}</p>
        </li>
      ))}
    </ol>
  );
}

export function OperatorNote({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <aside className="operator-note">
      <span>{label}</span>
      <div>{children}</div>
    </aside>
  );
}

export function OperatorActions({
  primary,
  secondary,
  align = "left",
}: {
  primary: OperatorAction;
  secondary?: OperatorAction;
  align?: "left" | "center";
}) {
  return (
    <div className={`operator-actions operator-actions--${align}`}>
      <Link href={primary.href} className="button-primary">
        {primary.label}
        <ArrowRight aria-hidden="true" />
      </Link>
      {secondary ? (
        <Link href={secondary.href} className="button-secondary">
          {secondary.label}
        </Link>
      ) : null}
    </div>
  );
}

export function OperatorFinalCta({
  eyebrow = "Next step",
  title,
  description,
  primary,
  secondary,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  primary: OperatorAction;
  secondary?: OperatorAction;
}) {
  return (
    <section className="operator-final-cta">
      <PageContainer width="wide">
        <RevealOnScroll>
          <div className="operator-final-cta__grid">
            <p>{eyebrow}</p>
            <h2>{title}</h2>
            <div>
              <p>{description}</p>
              <OperatorActions primary={primary} secondary={secondary} />
            </div>
          </div>
        </RevealOnScroll>
      </PageContainer>
    </section>
  );
}
