const defaultSiteUrl = "https://vercentlabs.com";

function normalizeUrl(value: string | undefined, fallback = "") {
  const candidate = value?.trim() || fallback;
  if (!candidate) return "";
  try {
    return new URL(candidate).origin;
  } catch {
    return fallback;
  }
}

const siteUrl = normalizeUrl(process.env.NEXT_PUBLIC_SITE_URL, defaultSiteUrl);

export const siteConfig = {
  name: "VercentLabs",
  companyName: "VercentLabs LLP",
  productName: "VercentLabs ERP",
  title:
    "VercentLabs ERP | 12 Connected Modules for Complete Business Operations",
  description:
    "Run accounting, procurement, sales, CRM, stock, manufacturing, projects, assets, point of sale, quality, support and HR & payroll on one connected ERP platform.",
  siteUrl,
  appUrl: normalizeUrl(process.env.NEXT_PUBLIC_ERP_APP_URL),
  email:
    process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "vercentlabs@gmail.com",
  locale: "en_IN",
  themeColor: "#4f46e5",
  audience: "Manufacturers, distributors, retailers and service businesses",
} as const;

export function absoluteUrl(pathname = "/") {
  return new URL(pathname, siteConfig.siteUrl + "/").toString();
}

export function getSignInHref() {
  return siteConfig.appUrl ? siteConfig.appUrl + "/login" : "/login";
}
