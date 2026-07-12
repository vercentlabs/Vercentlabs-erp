import { absoluteUrl, siteConfig } from "@/lib/site-config";

export default function OrganizationJsonLd() {
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": absoluteUrl("/#organization"),
        name: siteConfig.companyName,
        alternateName: siteConfig.name,
        url: siteConfig.siteUrl,
        email: siteConfig.email,
        logo: absoluteUrl("/brand/logo.png"),
        areaServed: "IN",
      },
      {
        "@type": "WebSite",
        "@id": absoluteUrl("/#website"),
        name: siteConfig.productName,
        url: siteConfig.siteUrl,
        inLanguage: "en-IN",
        publisher: {
          "@id": absoluteUrl("/#organization"),
        },
      },
      {
        "@type": "SoftwareApplication",
        name: siteConfig.productName,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: siteConfig.description,
        url: siteConfig.siteUrl,
        audience: {
          "@type": "BusinessAudience",
          audienceType: siteConfig.audience,
        },
        creator: {
          "@id": absoluteUrl("/#organization"),
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(schema).replace(/</g, "\\u003c"),
      }}
    />
  );
}
