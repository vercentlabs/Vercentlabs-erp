export type CrmMediumCode = "organic_search" | "paid_search" | "social" | "paid_social" | "email" | "referral" | "display" | "direct" | "event" | "marketplace" | "offline" | "other";
export declare const CRM_MEDIUMS: ReadonlyArray<{ code: CrmMediumCode; label: string; utm: string[] }>;
export declare function crmMediumLabel(code: string | null | undefined): string | null;
export declare function isCrmMedium(code: string | null | undefined): boolean;
export declare function mediumFromUtm(value: string | null | undefined): CrmMediumCode | null;
