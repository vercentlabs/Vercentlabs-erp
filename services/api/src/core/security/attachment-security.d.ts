export declare class AttachmentSecurityError extends Error {
  status: number;
  code: string;
}
export declare function verifyAttachmentContent(bytes: Uint8Array, mimeType: string): void;
export declare function scanAttachmentForUpload(bytes: Uint8Array, mimeType: string, env?: any): Promise<{ scanStatus: "clean"; scanner: string }>;
