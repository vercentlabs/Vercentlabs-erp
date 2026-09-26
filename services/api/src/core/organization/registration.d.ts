export declare class OrganizationRegistrationError extends Error {
  status: number;
  code: string;
  details?: unknown;
}
export declare function bootstrapOrganizationRoles(client: any, organizationId: string): Promise<Map<string, string>>;
export declare function registerOrganization(
  client: any,
  input: {
    fullName: string;
    email: string;
    password: string;
    organizationName: string;
    countryCode: string;
    baseCurrency: string;
    timezone: string;
  },
): Promise<{ userId: string; organizationId: string; email: string; fullName: string }>;
