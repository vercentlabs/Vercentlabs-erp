export declare function deliverAuthMessage(
  input: {
    type: "verify-email" | "reset-password" | "organization-invitation";
    email: string;
    url: string;
    organizationName?: string;
    expiresIn?: string;
  },
  env?: any,
): Promise<boolean>;

export declare function isAuthMailerConfigured(env?: any): boolean;
