export declare class AuthLifecycleError extends Error {
  status: number;
  code?: string;
}

export declare function createEmailVerificationToken(
  client: any,
  userId: string,
  env?: any,
): Promise<{ alreadyVerified: boolean; delivered?: boolean }>;

export declare function consumeEmailVerificationToken(
  client: any,
  token: string,
): Promise<{ userId: string }>;

export declare function requestPasswordReset(
  client: any,
  email: string,
  env?: any,
): Promise<{ requested: true }>;

export declare function resetPasswordWithToken(
  client: any,
  token: string,
  newPassword: string,
): Promise<{ userId: string }>;

export declare function createOrganizationInvitation(
  client: any,
  input: { organizationId: string; invitedByUserId: string; email: string; roleId: string },
  env?: any,
): Promise<{ invitationId: string }>;

export declare function getInvitationByToken(
  client: any,
  token: string,
): Promise<{
  id: string;
  organization_id: string;
  email: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  organization_name: string;
  role_name: string | null;
  has_existing_account: boolean;
}>;

export declare function acceptOrganizationInvitation(
  client: any,
  token: string,
  input: { fullName?: string; password?: string },
): Promise<{ userId: string; organizationId: string }>;

export declare function listPendingInvitationsForEmail(
  client: any,
  email: string,
): Promise<Array<{ id: string; organization_name: string; expires_at: string }>>;
