import Link from "next/link";

import { siteConfig } from "@/lib/site-config";

const footerGroups = [
  {
    title: "System",
    links: [
      ["Product", "/product"],
      ["Released features", "/features"],
      ["Module roadmap", "/modules"],
      ["Workflows", "/workflows"],
      ["Security", "/security"],
    ],
  },
  {
    title: "Contexts",
    links: [
      ["Manufacturing", "/industries/manufacturing"],
      ["Distribution", "/industries/distribution"],
      ["Retail", "/industries/retail"],
      ["Professional services", "/industries/professional-services"],
      ["Multi-company", "/industries/multi-company"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "/about"],
      ["Partners", "/partner"],
      ["Careers", "/careers"],
      ["Changelog", "/changelog"],
      ["Contact", "/contact"],
    ],
  },
  {
    title: "Terms",
    links: [
      ["Pricing", "/pricing"],
      ["Help", "/help"],
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Status", "/status"],
    ],
  },
] as const;

export default function SiteFooter() {
  return (
    <footer className="os-footer">
      <div className="os-footer__statement">
        <span>Vercentlabs ERP</span>
        <strong>Operations deserve software with a point of view.</strong>
      </div>

      <div className="os-footer__grid">
        <div className="os-footer__brand">
          <Link href="/" aria-label="Vercentlabs home">
            <span
              className="os-wordmark os-wordmark--footer"
              aria-hidden="true"
            >
              <span>VERCENTLABS</span>
              <span>LABS</span>
              <i />
            </span>
          </Link>
          <p>
            Governed customer operations today. A transparent ERP module roadmap
            for what comes next.
          </p>
          <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>
        </div>

        <nav aria-label="Footer navigation" className="os-footer__nav">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2>{group.title}</h2>
              {group.links.map(([label, href]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>

      <div className="os-footer__legal">
        <p>
          © {new Date().getFullYear()} {siteConfig.companyName}
        </p>
        <p>Built in India · Release scope stated plainly</p>
      </div>
    </footer>
  );
}
