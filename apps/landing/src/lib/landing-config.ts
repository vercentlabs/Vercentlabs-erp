import { absoluteUrl, siteConfig } from "@/lib/site-config";

export const landingConfig = {
  companyName: siteConfig.companyName,
  productName: siteConfig.productName,
  siteUrl: siteConfig.siteUrl,
  appUrl: siteConfig.appUrl,
  contactEmail: siteConfig.email,
  description: siteConfig.description,
} as const;

export { absoluteUrl };
