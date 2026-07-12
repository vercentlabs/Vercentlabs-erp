function removeTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

const configuredSiteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://vercentlabs.com";

const configuredAppUrl = process.env.NEXT_PUBLIC_ERP_APP_URL?.trim() || "";

export const landingConfig = {
  companyName: "VercentLabs LLP",
  productName: "Vercent ERP",
  siteUrl: removeTrailingSlash(configuredSiteUrl),
  appUrl: configuredAppUrl ? removeTrailingSlash(configuredAppUrl) : "",
  contactEmail:
    process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "vercentlabs@gmail.com",
  description:
    "A connected enterprise ERP platform for finance, supply chain, manufacturing, people, projects and reporting.",
} as const;

export function absoluteUrl(pathname = "/") {
  const normalizedPath = pathname.startsWith("/") ? pathname : "/" + pathname;

  return landingConfig.siteUrl + normalizedPath;
}
