export declare class MfaError extends Error {
  status: number;
  code?: string;
}
export declare function beginMfaEnrollment(client: any, userId: string, env?: any): Promise<{ secretBase32: string; otpauthUri: string }>;
export declare function confirmMfaEnrollment(client: any, userId: string, code: string, env?: any): Promise<{ recoveryCodes: string[] }>;
export declare function verifyMfaForSession(
  client: any,
  input: { sessionId: string; userId: string; code: string },
  env?: any,
): Promise<{ verified: true }>;
export declare function disableMfa(client: any, userId: string, code: string, env?: any): Promise<{ disabled: true }>;
export declare function regenerateRecoveryCodes(client: any, userId: string, code: string, env?: any): Promise<{ recoveryCodes: string[] }>;
export declare function setOrganizationMfaEnforcement(client: any, session: any, enforced: boolean): Promise<{ mfaEnforced: boolean }>;
export declare const __internal: {
  base32Encode(buffer: Buffer): string;
  base32Decode(text: string): Buffer;
  hotp(secretBuffer: Buffer, counter: number): string;
  totpAt(secretBuffer: Buffer, unixSeconds: number): string;
  matchTotpStep(secretBuffer: Buffer, code: string): number | null;
  claimTotpStep(client: any, userId: string, step: number): Promise<boolean>;
  totpUri(secretBase32: string, email: string, issuer?: string): string;
  generateRecoveryCode(): string;
  recoveryCodeHash(code: string): string;
};
